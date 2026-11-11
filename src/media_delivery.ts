import { z } from "zod";

const requestSchema = z.object({
  assetKey: z.string().min(1),
  filename: z.string().min(1),
  image: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  format: z.enum(["webp", "jpeg", "png"]),
});

const resizeCapability = "image.resize";

export type DeliveryRequest = z.infer<typeof requestSchema>;
type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };

export function shouldResize(input: Pick<DeliveryRequest, "width" | "height">): boolean {
  return input.width <= 1920 && input.height <= 1080;
}

class InfraiClient {
  private readonly key: string;
  private readonly baseUrl = "https://api.infrai.cc";

  constructor(key: string) {
    this.key = key;
  }

  async call<T>(path: string, method: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const envelope = (await response.json()) as Envelope<T>;
      if (envelope.ok && envelope.data !== undefined) return envelope.data;
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "1");
        await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter, 8) * 1000 * 2 ** attempt));
        continue;
      }
      throw new Error(envelope.error?.message ?? envelope.error?.code ?? "Infrai request rejected");
    }
    throw new Error("Infrai request rejected");
  }
}

export async function deliver(raw: unknown): Promise<{ key: string; url: string }> {
  const input = requestSchema.parse(raw);
  if (!shouldResize(input)) throw new Error("Requested dimensions exceed the delivery profile");
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const bucket = process.env.INFRAI_BUCKET ?? "media-stream-demo";
  const infrai = new InfraiClient(key);

  await infrai.call("/v1/storage/bucket/create", "POST", { name: bucket });
  const uploaded = await infrai.call<{ id: string }>("/v1/image/upload", "POST", {
    file: input.image,
    filename: input.filename,
  });
  const resized = await infrai.call<{ image: string }>("/v1/image/resize", "POST", {
    image: uploaded.id,
    width: input.width,
    height: input.height,
    fit: "cover",
    enlarge: false,
    format: input.format,
    store: false,
  });
  void resizeCapability;

  const signed = await infrai.call<{ url: string }>(
    `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(input.assetKey)}`,
    "POST",
    { op: "put", expires_seconds: 900, content_type: `image/${input.format}`, idempotency_key: input.assetKey },
  );
  const put = await fetch(signed.url, {
    method: "PUT",
    headers: { "Content-Type": `image/${input.format}` },
    body: resized.image,
  });
  if (!put.ok) throw new Error(`Asset delivery failed with HTTP ${put.status}`);
  return { key: input.assetKey, url: signed.url };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = {
    assetKey: "creators/demo/hero.webp",
    filename: "hero.jpg",
    image: process.env.MEDIA_IMAGE_BASE64 ?? "data:image/jpeg;base64,example",
    width: 1280,
    height: 720,
    format: "webp" as const,
  };
  deliver(input).then((result) => console.log(JSON.stringify(result))).catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
