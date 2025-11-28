import * as t from 'lib0/testing'
import * as Y from 'yjs'
import * as env from 'lib0/environment'
import { port } from '../src/index.js'
import * as db from '../src/db.js'

const baseUrl = `http://localhost:${port}`

/**
 * @param {string} bucketName
 */
const ensureCleanBucket = async bucketName => {
  const exists = await db.minioClient.bucketExists(bucketName)
  if (exists) {
    const objectsList = []
    const stream = db.minioClient.listObjectsV2(bucketName, '', true)
    for await (const obj of stream) {
      objectsList.push(obj.name)
    }
    if (objectsList.length > 0) {
      await db.minioClient.removeObjects(bucketName, objectsList)
    }
  } else {
    // Create the bucket
    await db.minioClient.makeBucket(bucketName)
  }
}

const bucketName = env.ensureConf('s3-bucket')
await ensureCleanBucket(bucketName)

/**
 * Send an update to the attribution API
 * @param {string} docid
 * @param {string} user
 * @param {Uint8Array} update
 * @param {{[key:string]:string}} customAttrs
 * @returns {Promise<void>}
 */
const sendUpdate = async (docid, user, update, customAttrs = {}) => {
  const queryParams = new URLSearchParams({ user, ...customAttrs })
  const url = `${baseUrl}/attribute/${docid}?${queryParams}`
  const response = await fetch(url, {
    method: 'POST',
    body: /** @type {Uint8Array<ArrayBuffer>} */ (update),
    headers: {
      'Content-Type': 'application/octet-stream'
    }
  })
  if (!response.ok) {
    throw new Error(`[${url}]: API error: ${response.status} ${response.statusText}`)
  }
  return await response.json()
}

/**
 * Store a version.
 * @param {string} docid
 * @param {Uint8Array<ArrayBuffer>} doc
 * @returns {Promise<void>}
 */
const storeVersion = async (docid, doc) => {
  const url = `${baseUrl}/version/${docid}`
  const response = await fetch(url, {
    method: 'POST',
    body: doc,
    headers: {
      'Content-Type': 'application/octet-stream'
    }
  })
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`)
  }
  return await response.json()
}

/**
 * @param {string} docid
 * @returns {Promise<any>}
 */
const getVersionDeltas = async (docid) => {
  const url = `${baseUrl}/version-deltas/${docid}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`)
  }
  return await response.json()
}

/**
 * @param {string} docid
 * @return {Promise<Y.IdMap<any>>}
 */
const fetchAttributions = async docid => {
  const url = `${baseUrl}/attributions/${docid}`
  const response = await fetch(url)
  const binAttrs = await response.bytes()
  const attrs = Y.decodeIdMap(binAttrs)
  return attrs
}

/**
 * @param {t.TestCase} _tc
 */
export const testSimpleRequest = async _tc => {
  const docid = 'testdoc'
  const ydoc = new Y.Doc()
  ydoc.getText().insert(0, 'hi there')
  const update = Y.encodeStateAsUpdate(ydoc)
  await sendUpdate(docid, 'user53', update)
  const attrsFetched = await fetchAttributions(docid)
  t.assert(attrsFetched.clients.size > 0)
  const clientAttrs = attrsFetched.clients.get(ydoc.clientID)?.getIds() || []
  t.assert(clientAttrs.length === 1)
  t.assert(clientAttrs[0].attrs.length === 2)
  t.assert(clientAttrs[0].attrs[0].name === 'insert')
  t.assert(clientAttrs[0].attrs[1].name === 'insertAt')
}

/**
 * @param {t.TestCase} _tc
 */
export const testCustomAttr = async _tc => {
  const docid = _tc.testName
  const ydoc = new Y.Doc()
  ydoc.getText().insert(0, 'hi there')
  const update = Y.encodeStateAsUpdate(ydoc)
  await sendUpdate(docid, 'user53', update, { myCustomAttr: '42' })
  const attrsFetched = await fetchAttributions(docid)
  t.assert(attrsFetched.clients.size > 0)
  const clientAttrs = attrsFetched.clients.get(ydoc.clientID)?.getIds() || []
  t.assert(clientAttrs.length === 1)
  t.assert(clientAttrs[0].attrs.length === 3)
  t.assert(clientAttrs[0].attrs[2].name === '_myCustomAttr')
  t.assert(clientAttrs[0].attrs[2].val === '42')
}

/**
 * @param {t.TestCase} _tc
 */
export const testVersionStore = async _tc => {
  const docid = _tc.testName
  const ydoc = new Y.Doc()
  ydoc.getText('ytext').insert(0, 'hello')
  await storeVersion(docid, Y.encodeStateAsUpdate(ydoc))
  ydoc.getText('ytext').insert(5, 'world!')
  await storeVersion(docid, Y.encodeStateAsUpdate(ydoc))
  const ds = await getVersionDeltas(docid)
  console.log('deltas', JSON.stringify(ds.deltas, null, 2))
  debugger
}
