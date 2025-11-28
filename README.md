
# Simple Attribution Server

Stop-gap solution to storing & retrieving attributions and versions in Yjs@v14. This simple
server only requires an S3 endpoint, which can be configured using environment
variables.

```
npx y-simple-attribution-server --port 4000
```

```env
# Configure s3 endpoint via environment variables
S3_ENDPOINT=127.0.0.1
S3_PORT=9000
S3_SSL=false
S3_BUCKET=test-attributions
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
```

## testing

For testing, you may use the included minio s3 server, and the testing
configuration.

```
npm run minio
npm start
```

## Terminology
- `version`: refers to the state of a Yjs document at a point in time.
- `delta`: a general-purpose changeset representation from the `lib0` project.
It can be used to describe the (attributed) differences between two versions.
- `attribution`: A change may be attributed to a user/AI agent, a timestamp,
and other properties. The delta format can describe attributed changes.

## API

- `GET /attributions/{:docid}` - retrieve all attributions for a specific document
- `POST /attribute/{:docid}?user=userid&timestamp=number body:octet-stream` -
Attribute an update by sending the binary encoded Yjs update, alongside userid
and an optional timestamp, which will be associated with the change. You may add
more custom attributes as URL query parameters. They will be prefixed with a `_`
to avoid collisions with Yjs-native attributes.
- `POST /version/{:docid}` - create a new version of a document by posting the
binary encoded Yjs document.
- `GET /version-deltas/{:docid}` - the differences between all versions (in the
JSON-encoded delta format)

## Usage

An existing Yjs backend may use the simple attribution server to attribute all
incoming changes to the user. Whenever it receives a change, it should send a
`POST /attribute/{:docid}?user=userid body:yjs-update` request to
y-simple-attribution-server.

The client may later retrieve all attributions by calling `GET
/attributions/{:docid}`. This request returns an encoded `IdMap`, which maps
change-ranges to attributes.

The client can use the attributions to render who created which content. It can
also use the attributions to render the attributed differences between two
versions.

The client can also request the history of all (attributed) changes for a
document by calling `GET /version-deltas/{:docid}`

## Docker

```
# configure the environment variables in `compose.yaml` to your s3-compatible backend
docker compose up
```
