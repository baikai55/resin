export type ResidentialEntry = {
  residential?: boolean | null;
  fraud?: number | null;
  isp?: string;
  cc?: string;
  source?: string;
  ts?: string;
};

export type ResidentialStateResponse = {
  updated_at: string;
  count: number;
  items: Record<string, ResidentialEntry>;
};
