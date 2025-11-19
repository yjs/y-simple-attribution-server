import * as t from 'lib0/testing'
import * as Y from 'yjs'
import * as env from 'lib0/environment'
import { port } from '../src/index.js'
import { minioClient } from '../src/merge-queue.js'

const baseUrl = `http://localhost:${port}`

/**
 * @param {string} bucketName
 */
const ensureCleanBucket = async bucketName => {
  const exists = await minioClient.bucketExists(bucketName)
  if (exists) {
    const objectsList = []
    const stream = minioClient.listObjectsV2(bucketName, '', true)
    for await (const obj of stream) {
      objectsList.push(obj.name)
    }
    if (objectsList.length > 0) {
      await minioClient.removeObjects(bucketName, objectsList)
    }
  } else {
    // Create the bucket
    await minioClient.makeBucket(bucketName)
  }
}

const bucketName = env.ensureConf('s3-bucket')
await ensureCleanBucket(bucketName)

/**
 * Send an update to the attribution API
 * @param {string} docid
 * @param {string} user
 * @param {Uint8Array} update
 * @returns {Promise<void>}
 */
const sendUpdate = async (docid, user, update) => {
  const queryParams = new URLSearchParams({ user })
  const url = `${baseUrl}/${docid}?${queryParams}`
  const response = await fetch(url, {
    method: 'POST',
    body: /** @type {Uint8Array<ArrayBuffer>} */ (update),
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
 * @return {Promise<Y.IdMap<any>>}
 */
const fetchAttributions = async docid => {
  const url = `${baseUrl}/${docid}`
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
