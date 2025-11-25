#!/usr/bin/env node

import Koa from 'koa'
import Router from '@koa/router'
import * as Y from 'yjs'
import * as time from 'lib0/time'
import * as s from 'lib0/schema'
import * as env from 'lib0/environment'
import * as number from 'lib0/number'
import * as object from 'lib0/object'
import { scheduleAttributionForMerge, getAttributions } from './merge-queue.js'
import v8 from 'v8'

/**
 * @typedef {object} AttributedUpdate
 * @property {Uint8Array} AttributedUpdate.update
 * @property {string} AttributedUpdate.user
 * @property {number} AttributedUpdate.timestamp
 */

const $attributedUpdate = s.$object({ update: s.$constructedBy(Uint8Array), user: s.$string, timestamp: s.$number })

const app = new Koa()
const router = new Router()

/**
 * Return available heap-size.
 *
 * @return number
 */
const checkAvailableHeapSize = () => {
  const heapStats = v8.getHeapStatistics();
  const heapUsed = heapStats.used_heap_size;
  const heapLimit = heapStats.heap_size_limit * .90 // use 90 percent of heap limit max
  return heapLimit - heapUsed
}

/**
 * @param {Koa.Context} ctx
 */
const getRawBody = async ctx => {
  const chunks = []
  for await (const chunk of ctx.req) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

router.post('/:docid', async ctx => {
  const { docid } = ctx.params
  let { user, timestamp = time.getUnixTime(), ...customQuery } = ctx.query
  if (s.$string.check(timestamp)) {
    timestamp = number.parseInt(timestamp)
  }
  const updateBuf = await getRawBody(ctx)
  if (!updateBuf.length) {
    ctx.throw(400, 'Missing update data in request body')
  }
  const update = new Uint8Array(updateBuf)
  if (!$attributedUpdate.check({ update, user, timestamp })) {
    return ctx.throw(400, 'Expecting parameters: user:string, timestamp:number?')
  }
  if (checkAvailableHeapSize() - (update.byteLength * 100) < 0) {
    return ctx.throw(500, 'Out of memory - rejecting update because there is not emough memory available.')
  }
  try {
    const updateParsed = Y.readUpdateIdRanges(update)
    const attributions = Y.createIdMapFromIdSet(updateParsed.inserts, [Y.createAttributionItem('insert', user), Y.createAttributionItem('insertAt', timestamp)])
    Y.insertIntoIdMap(attributions, Y.createIdMapFromIdSet(updateParsed.deletes, [Y.createAttributionItem('delete', user), Y.createAttributionItem('deleteAt', timestamp)]))
    if (object.size(customQuery) > 0) {
      const allChanges = Y.mergeIdSets([updateParsed.inserts, updateParsed.deletes])
      const customAttrs = object.map(customQuery, (val, key) => {
        s.$string.expect(val)
        return Y.createAttributionItem('_' + key, val)
      })
      Y.insertIntoIdMap(attributions, Y.createIdMapFromIdSet(allChanges, customAttrs))
    }
    scheduleAttributionForMerge(docid, attributions)
  } catch (err) {
    const errMessage = 'failed to parse update'
    console.error(errMessage)
    return ctx.throw(400, errMessage)
  }
  ctx.body = {
    success: true
  }
})

router.get('/:docid', async ctx => {
  const docid = ctx.params.docid
  const attributions = await getAttributions(docid)
  ctx.body = Buffer.from(Y.encodeIdMap(attributions))
  ctx.type = 'application/octet-stream'
})

app
  .use(router.routes())
  .use(router.allowedMethods())

export const port = number.parseInt(env.getParam('port', '4000'))
app.listen(port)
