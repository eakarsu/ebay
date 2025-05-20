import React from 'react';
import { ArrowRight } from 'lucide-react';

export function Hero() {
  return (
    <div className="bg-gradient-to-r from-purple-50 to-blue-50 py-20">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6">
            Easy automation for busy people
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Zapier moves info between your web apps automatically, so you can focus on your most important work.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a 
              href="#" 
              className="w-full sm:w-auto bg-purple-600 text-white px-8 py-3 rounded-lg hover:bg-purple-700 flex items-center justify-center"
            >
              Get started free
              <ArrowRight className="ml-2 h-5 w-5" />
            </a>
            <a 
              href="#" 
              className="w-full sm:w-auto text-gray-600 hover:text-gray-900 px-8 py-3"
            >
              How it works
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}