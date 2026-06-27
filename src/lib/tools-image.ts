// Image generation tool — lets the AI create images and embed them in responses
import type { ToolDefinition } from "./types";
import type { ToolExecutor } from "./tools";
import { db } from "./db";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const generateImage: ToolExecutor = {
  definition: {
    type: "function",
    function: {
      name: "generate_image",
      description:
        "Generate an image from a text prompt using AI image generation. The image is saved and can be embedded in your response. Use this when the user asks for an image, diagram, illustration, or visual content. After generating, embed it in your response using ![description](/api/files/IMAGE_ID) markdown syntax with the returned image ID.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Detailed description of the image to generate. Include style, subject, details, and quality terms.",
          },
          size: {
            type: "string",
            description: "Image size. Options: 1024x1024 (square), 1344x768 (landscape), 768x1344 (portrait), 1440x720 (wide), 720x1440 (tall). Default: 1024x1024",
          },
        },
        required: ["prompt"],
      },
    },
  },
  async execute(args, ctx) {
    const prompt = String(args.prompt || "");
    const size = String(args.size || "1024x1024");
    if (!prompt) return "Error: prompt is required";

    const validSizes = ["1024x1024", "1344x768", "768x1344", "1440x720", "720x1440", "864x1152", "1152x864"];
    const finalSize = validSizes.includes(size) ? size : "1024x1024";

    try {
      // Use z-ai-web-dev-sdk for image generation
      const ZAI = (await import("z-ai-web-dev-sdk")).default;
      const zai = await ZAI.create();
      const response = await zai.images.generations.create({
        prompt,
        size: finalSize as any,
      });

      const imageBase64 = response.data[0].base64;
      const buffer = Buffer.from(imageBase64, "base64");

      // Save to uploads directory with a unique ID
      const imageId = crypto.randomUUID();
      const filename = `${imageId}.png`;
      const storagePath = path.resolve(process.cwd(), "uploads", filename);
      await fs.mkdir(path.dirname(storagePath), { recursive: true });
      await fs.writeFile(storagePath, buffer);

      // Store in DB as an UploadedFile so it can be served
      const file = await db.uploadedFile.create({
        data: {
          id: imageId,
          filename: `generated-${prompt.slice(0, 30).replace(/[^a-zA-Z0-9]/g, "-")}.png`,
          mimeType: "image/png",
          size: buffer.length,
          storagePath,
          extractedText: `AI-generated image: ${prompt}`,
          extracted: true,
        },
      });

      // Return instruction for the AI to embed the image
      return `Image generated successfully. To embed it in your response, use this markdown:\n\n![${prompt.slice(0, 50)}](/api/files/${imageId})\n\nImage ID: ${imageId}\nSize: ${finalSize}\nFile: ${file.filename}`;
    } catch (e) {
      return `Image generation error: ${(e as Error).message}`;
    }
  },
};

export const imageTools: Record<string, ToolExecutor> = {
  generate_image: generateImage,
};
