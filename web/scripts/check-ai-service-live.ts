import { getAiServiceInternalHealth } from "../src/ai-service/client";

async function main() {
  const response = await getAiServiceInternalHealth();

  if (response.status !== "ok") {
    throw new Error(`Unexpected AI service health status: ${response.status}`);
  }
}

main()
  .then(() => {
    console.log("ai_service_live_check=passed");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
