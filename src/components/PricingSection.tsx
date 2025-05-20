import React from 'react';
import { Check } from 'lucide-react';
import { pricingTiers } from '../data';

export function PricingSection() {
  return (
    <div className="py-16 bg-gray-50">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Plans for every workflow
          </h2>
          <p className="text-xl text-gray-600">
            Start free and scale as you grow
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {pricingTiers.map(tier => (
            <div 
              key={tier.name}
              className={`bg-white rounded-lg shadow-lg p-8 ${
                tier.isPopular ? 'ring-2 ring-purple-600' : ''
              }`}
            >
              {tier.isPopular && (
                <span className="bg-purple-100 text-purple-600 px-3 py-1 rounded-full text-sm font-medium">
                  Most Popular
                </span>
              )}
              <h3 className="text-xl font-bold text-gray-900 mt-4">
                {tier.name}
              </h3>
              <div className="mt-4 flex items-baseline">
                <span className="text-4xl font-bold">${tier.price}</span>
                <span className="ml-2 text-gray-600">/{tier.period}</span>
              </div>
              <ul className="mt-6 space-y-4">
                {tier.features.map((feature, index) => (
                  <li key={index} className="flex items-start">
                    <Check className="h-5 w-5 text-green-500 mr-2" />
                    <span>{feature}</span>
                  </li>
                ))}
                <li className="text-sm text-gray-600">{tier.taskLimit}</li>
                <li className="text-sm text-gray-600">{tier.userLimit}</li>
              </ul>
              <button className={`mt-8 w-full py-3 px-4 rounded-lg font-medium ${
                tier.isPopular
                  ? 'bg-purple-600 text-white hover:bg-purple-700'
                  : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
              }`}>
                Choose {tier.name}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}