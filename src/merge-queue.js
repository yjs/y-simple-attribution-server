/**
 * Attributions are stored in binary form in an s3 bucket. The pattern for the filename is:
 *   y:attrs:v1:${docid}:${timestamp}
 *
 * Due to concurrency, it may happen that multiple attribution-files for a single ydoc exist. These
 * will be merged automatically.
 */

import * as Y from 'yjs'
import * as time from 'lib0/time'
import * as map from 'lib0/map'
import * as env from 'lib0/environment'
import * as number from 'lib0/number'
import * as queue from 'lib0/queue'
import * as promise from 'lib0/promise'
import * as math from 'lib0/math'
import * as minio from 'minio'

/**
 * Minimum time (in ms) to cache messages before writing an update to s3.
 */
const minCacheTime = 5000
const s3endpoint = env.ensureConf('s3-endpoint')
const s3port = number.parseInt(env.ensureConf('s3-port'))
const s3useSSL = !['false', '0'].includes(env.getConf('s3-ssl') || 'false')
const s3accessKey = env.ensureConf('s3-access-key')
const s3secretKey = env.ensureConf('s3-secret-key')

export const minioClient = new minio.Client({
  endPoint: s3endpoint,
  port: s3port,
  useSSL: s3useSSL,
  accessKey: s3accessKey,
  secretKey: s3secretKey
})

const bucketName = env.ensureConf('s3-bucket')

/**
 * @param {string} filename
 * @return {Promise<Uint8Array<ArrayBuffer>>}
 */
const getBinaryFile = async (filename) => {
  const stream = await minioClient.getObject(bucketName, filename)
  return promise.create((resolve, reject) => {
    /**
     * @type {Buffer[]}
     */
    const chunks = []
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

/**
 * @param {string} docid
 * @return {Promise<{ attributions: Y.IdMap<any>[], knownAttributionFileNames: string[] }>}
 */
const getPersistedAttributions = (docid) => promise.create((resolve, reject) => {
  /**
   * @type {string[]}
   */
  const knownAttributionFileNames = []
  const stream = minioClient.listObjects(bucketName, `y:attrs:v1:${docid}`, true)
  stream.on('data', (obj) => {
    if (obj.name != null) knownAttributionFileNames.push(obj.name)
  })
  stream.on('error', err => {
    reject(new Error(`[minio]: Error retrieving attributions (${err.toString()})`))
  })
  stream.on('end', async () => {
    const attributions = await promise.all(knownAttributionFileNames.map(async filename => {
      const binAttr = await getBinaryFile(filename)
      return Y.decodeIdMap(binAttr)
    }))
    resolve({ attributions, knownAttributionFileNames })
  })
})

class MergeQueueItem extends queue.QueueNode {
  /**
   * @param {string} docid
   * @param {number} createdAt
   */
  constructor (docid, createdAt) {
    super()
    this.docid = docid
    this.createdAt = createdAt
  }
}
/**
 * @type {queue.Queue<MergeQueueItem>}
 */
const mergeQueue = queue.create()
/**
 * @type {Map<string,Y.IdMap<any>[]>}
 */
const cachedAttributions = new Map()
/**
 * @param {string} docid
 * @param {Y.IdMap<any>} attr
 */
export const scheduleAttributionForMerge = (docid, attr) => {
  if (map.setIfUndefined(cachedAttributions, docid, () => /** @type {Y.IdMap<any>[]} */ ([])).push(attr) === 1) {
    // first added item, add this to the queue
    queue.enqueue(mergeQueue, new MergeQueueItem(docid, time.getUnixTime()))
  }
}

/**
 * @param {string} docid
 */
export const getAttributions = async docid => {
  const { attributions: persistedAttrs } = await getPersistedAttributions(docid)
  const allAttrs = [...persistedAttrs, ...(cachedAttributions.get(docid) || [])]
  if (allAttrs.length > 0) {
    Y.insertIntoIdMap(allAttrs[0], Y.mergeIdMaps(allAttrs.slice(1)))
    return allAttrs[0]
  } else {
    return Y.createIdMap()
  }
}

/**
 * This neverending loop consumes the mergeQueue
 */
const mergeLoop = async () => {
  while (true) {
    const qitem = queue.dequeue(mergeQueue)
    if (qitem == null) {
      await promise.wait(1000)
      continue
    }
    try {
      await promise.wait(math.max(minCacheTime - (time.getUnixTime() - qitem.createdAt), 0))
      const { attributions: persistedAttrs, knownAttributionFileNames } = await getPersistedAttributions(qitem.docid)
      const cachedAttrs = cachedAttributions.get(qitem.docid) || []
      const cacheLen = cachedAttrs.length
      const allAttrs = [...persistedAttrs, ...cachedAttrs]
      if (allAttrs.length > 0) {
        Y.insertIntoIdMap(allAttrs[0], Y.mergeIdMaps(allAttrs.slice(1)))
        const encAttrs = Y.encodeIdMap(allAttrs[0])
        await minioClient.putObject(bucketName, `y:attrs:v1:${qitem.docid}:${time.getUnixTime()}`, Buffer.from(encAttrs))
        await minioClient.removeObjects(bucketName, knownAttributionFileNames)
      }
      cachedAttrs.splice(0, cacheLen)
      if (cachedAttrs.length === 0) {
        cachedAttributions.delete(qitem.docid)
      } else {
        // more attrs were added, enqueue again
        queue.enqueue(mergeQueue, new MergeQueueItem(qitem.docid, time.getUnixTime()))
      }
    } catch (err) {
      console.error(err)
      // enqueue this again
      queue.enqueue(mergeQueue, new MergeQueueItem(qitem.docid, time.getUnixTime()))
    }
  }
}

const persistenceConcurrency = number.parseInt(env.getConf('persistence-concurrency') || '3')
for (let i = 0; i < persistenceConcurrency; i++) {
  mergeLoop()
}
