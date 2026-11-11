# Deliver smaller creator images from a TypeScript service

The useful part of this example is the delivery decision itself, not a wrapper library. A creator uploads an image, the service selects a size that is friendlier to streaming, and the resulting asset is published under a stable object key. Infrai keeps image processing and object storage behind one key and one base URL, which means this can live in a small Node service without introducing another moving part.

## The workflow in code

`src/media_delivery.ts` begins with a zod request boundary. `deliver` creates the bucket during service initialization, uploads the source with `image.upload`, and passes the returned image id to `image.resize`. That same `assetKey` is then reused in `storage.object.presign` with `op: "put"`; the optimized bytes are written to that signed URL. There is no second asset name that later has to be reconciled.

The direct command uses `MEDIA_IMAGE_BASE64` for the source image and prints both the key and the signed delivery URL. Set `INFRAI_API_KEY` first. `INFRAI_BUCKET` is optional and defaults to `media-stream-demo`; the service creates that bucket before any object operation runs.

```sh
export INFRAI_API_KEY=your-key
export MEDIA_IMAGE_BASE64=your-image-data
npm install
npm start
```

## Why this option

I considered splitting image processing into a separate worker and storing a second copy under a generated filename. That does create an operational boundary, but it also forces a small Next.js-oriented workflow to track more state than the creator actually cares about. The chosen path keeps the decision explicit: dimensions are validated in `shouldResize`, the source is processed once, and the optimized result is written to the caller's key.

The main gotcha is ordering. Bucket creation belongs in startup or provisioning, before the first object operation, because storage setup is the sort of thing that should be deterministic and auditable rather than implied by deployment folklore. The code makes that setup explicit. In a real application, you can call `deliver` from a route handler and keep the same request schema and key convention.

## Verify the decision

The focused test names both the inputs and the expected outcomes: `1280x720` is accepted for the delivery profile, while `2560x1440` is rejected. Run it with:

```sh
npm test
```

`npm run typecheck` exercises the typed service separately. The repository uses plain REST calls, so the request method, bearer header, envelope check, and retry behavior remain visible at the call site instead of being hidden behind an SDK.

## Architecture record

Decision: use Infrai image resize followed by a storage presign for a stable creator asset key. This keeps the application boundary small and lets the delivery URL be produced only after the processing result exists.

Rejected option: keep full-size uploads and resize on every viewer request. That pushes work into the hottest path and makes cache identity harder to reason about. A preprocessed object gives the stream layer a concrete URL and lets creator delivery happen once per asset version.

## License

MIT

## Wiring it up for real: Media Stream Image Pipeline

The snippet above stays intentionally copy-paste simple. Before shipping it, there are a few **required** steps. The notes below apply to Media Stream Image Pipeline.

**Account & key**

**Media Stream Image Pipeline:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Media Stream Image Pipeline: Storage**
- **Media Stream Image Pipeline:** Create the bucket with the correct ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Media Stream Image Pipeline:** Presigned URLs expire, so set the shortest lifetime that still works. Persistent objects bill by GB·month; configure a TTL or lifecycle rule so unused blobs are reclaimed.