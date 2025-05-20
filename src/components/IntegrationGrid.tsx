import React from 'react';
import { integrations } from '../data';

export function IntegrationGrid() {
  return (
    <div className="py-16 bg-white">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Connect your apps and automate workflows
          </h2>
          <p className="text-xl text-gray-600">
            5,000+ integrations to build the automation you need
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {integrations.map(integration => (
            <div 
              key={integration.id}
              className="p-6 border rounded-lg hover:shadow-lg transition-shadow"
            >
              <img 
                src={integration.icon} 
                alt={integration.name}
                className="w-12 h-12 rounded mb-4"
              />
              <h3 className="font-semibold text-gray-900 mb-2">
                {integration.name}
              </h3>
              <p className="text-gray-600 text-sm">
                {integration.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}