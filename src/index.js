#!/usr/bin/env node

import Koa from 'koa'
import Router from '@koa/router'
import * as Y from 'yjs'
import * as time from 'lib0/time'
import * as s from 'lib0/schema'
import * as env from 'lib0/environment'
import * as number from 'lib0/number'
import { scheduleAttributionForMerge, getAttributions } from './merge-queue.js'

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
  const { user, timestamp = time.getUnixTime() } = ctx.query
  const updateBuf = await getRawBody(ctx)
  if (!updateBuf.length) {
    ctx.throw(400, 'Missing update data in request body')
  }
  const update = new Uint8Array(updateBuf)
  if (!$attributedUpdate.check({ update, user, timestamp })) {
    return ctx.throw(400, 'Expecting parameters: user:string, timestamp:number?')
  }
  try {
    const updateParsed = Y.readUpdateIdRanges(update)
    const attributions = Y.createIdMapFromIdSet(updateParsed.inserts, [Y.createAttributionItem('insert', user), Y.createAttributionItem('insertAt', timestamp)])
    Y.insertIntoIdMap(attributions, Y.createIdMapFromIdSet(updateParsed.deletes, [Y.createAttributionItem('delete', user), Y.createAttributionItem('deleteAt', timestamp)]))
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
