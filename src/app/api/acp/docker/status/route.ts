import { NextResponse } from "next/server";
import { getDockerDetector, DEFAULT_DOCKER_AGENT_IMAGE } from "@/core/acp/docker";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.PAGE_SNAPSHOT_FIXTURE_MODE === "1") {
    return NextResponse.json({
      available: true,
      daemonRunning: true,
      version: "fixture",
      checkedAt: new Date().toISOString(),
      image: DEFAULT_DOCKER_AGENT_IMAGE,
      imageAvailable: true,
    });
  }

  const detector = getDockerDetector();
  const image = DEFAULT_DOCKER_AGENT_IMAGE;

  const [status, imageAvailable] = await Promise.all([
    detector.checkAvailability(),
    detector.isImageAvailable(image),
  ]);

  return NextResponse.json({
    ...status,
    checkedAt: new Date().toISOString(),
    image,
    imageAvailable: status.available ? imageAvailable : false,
  });
}
