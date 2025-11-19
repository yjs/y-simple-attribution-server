
# Simple Attribution Server

Stop-gap solution to storing & retrieving attributions in Yjs@v14. This simple
server only requires an S3 endpoint, which can be configured using environment
variables.

```
y-simple-attribution-server --port 4000
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
npm test
```

## API

- `GET /:docid` - retrieve all attributions for a specific document
- `POST /:docid?user=userid&timestamp=number body:octet-stream` - Update attributions by sending the binary encoded Yjs update, alongside userid and an optional timestamp, which will be associated to the change.
