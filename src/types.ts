export interface Integration {
  id: string;
  name: string;
  icon: string;
  category: string;
  description: string;
}

export interface Automation {
  id: string;
  title: string;
  description: string;
  apps: {
    from: Integration;
    to: Integration;
  };
  popularityScore: number;
}

export interface PricingTier {
  name: string;
  price: number;
  period: string;
  features: string[];
  isPopular?: boolean;
  taskLimit: string;
  userLimit: string;
}