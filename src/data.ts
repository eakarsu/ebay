import { Integration, Automation, PricingTier } from './types';

export const integrations: Integration[] = [
  {
    id: '1',
    name: 'Slack',
    icon: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=100',
    category: 'Communication',
    description: 'Connect your team communication'
  },
  {
    id: '2',
    name: 'Gmail',
    icon: 'https://images.unsplash.com/photo-1557568192-2fafc8b5bdc9?w=100',
    category: 'Email',
    description: 'Automate your email workflow'
  },
  {
    id: '3',
    name: 'Trello',
    icon: 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?w=100',
    category: 'Project Management',
    description: 'Streamline project tasks'
  },
  {
    id: '4',
    name: 'Google Sheets',
    icon: 'https://images.unsplash.com/photo-1509966756634-9c23dd6e6815?w=100',
    category: 'Spreadsheets',
    description: 'Automate data entry and analysis'
  }
];

export const automations: Automation[] = [
  {
    id: '1',
    title: 'Send Slack messages for new Gmail emails',
    description: 'Get notified in Slack when important emails arrive',
    apps: {
      from: integrations[1],
      to: integrations[0]
    },
    popularityScore: 95
  },
  {
    id: '2',
    title: 'Create Trello cards from Gmail',
    description: 'Convert emails into actionable tasks',
    apps: {
      from: integrations[1],
      to: integrations[2]
    },
    popularityScore: 88
  }
];

export const pricingTiers: PricingTier[] = [
  {
    name: 'Free',
    price: 0,
    period: 'forever',
    features: [
      '5 Zaps',
      'Basic automations',
      'Email support'
    ],
    taskLimit: '100 tasks/month',
    userLimit: '1 user'
  },
  {
    name: 'Starter',
    price: 19.99,
    period: 'per month',
    features: [
      '20 Zaps',
      'Multi-step Zaps',
      'Premium apps',
      'Priority support'
    ],
    taskLimit: '750 tasks/month',
    userLimit: '1 user'
  },
  {
    name: 'Professional',
    price: 49,
    period: 'per month',
    features: [
      'Unlimited Zaps',
      'Custom logic paths',
      'Premium apps & features',
      'Phone support'
    ],
    isPopular: true,
    taskLimit: '2,000 tasks/month',
    userLimit: '2 users'
  }
];