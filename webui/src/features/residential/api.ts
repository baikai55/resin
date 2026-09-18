import { apiRequest } from "../../lib/api-client";
import type { ResidentialStateResponse } from "./types";

export async function getResidentialState(): Promise<ResidentialStateResponse> {
  return apiRequest<ResidentialStateResponse>("/api/v1/residential");
}
