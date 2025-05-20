import React from 'react';
import { Zap } from 'lucide-react';

export function Footer() {
  const handleClick = (section: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    console.log(`Clicked ${section}`);
    // Add your navigation logic here
  };

  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <div className="col-span-2">
            <a 
              href="/" 
              className="flex items-center space-x-2 mb-4"
              onClick={(e) => {
                e.preventDefault();
                console.log('Home clicked');
              }}
            >
              <Zap className="h-8 w-8 text-purple-400" />
              <span className="text-xl font-bold text-white">Zapier</span>
            </a>
            <p className="text-gray-400 mb-4">
              Easy automation for busy people. Zapier moves info between your web apps automatically.
            </p>
          </div>
          
          <div>
            <h3 className="font-semibold text-white mb-4">Product</h3>
            <ul className="space-y-2">
              <li><a href="/features" onClick={handleClick('features')} className="hover:text-white cursor-pointer">Features</a></li>
              <li><a href="/integrations" onClick={handleClick('integrations')} className="hover:text-white cursor-pointer">Integrations</a></li>
              <li><a href="/pricing" onClick={handleClick('pricing')} className="hover:text-white cursor-pointer">Pricing</a></li>
              <li><a href="/enterprise" onClick={handleClick('enterprise')} className="hover:text-white cursor-pointer">Enterprise</a></li>
            </ul>
          </div>
          
          <div>
            <h3 className="font-semibold text-white mb-4">Solutions</h3>
            <ul className="space-y-2">
              <li><a href="/marketing" onClick={handleClick('marketing')} className="hover:text-white cursor-pointer">Marketing</a></li>
              <li><a href="/sales" onClick={handleClick('sales')} className="hover:text-white cursor-pointer">Sales</a></li>
              <li><a href="/it" onClick={handleClick('it')} className="hover:text-white cursor-pointer">IT</a></li>
              <li><a href="/finance" onClick={handleClick('finance')} className="hover:text-white cursor-pointer">Finance</a></li>
            </ul>
          </div>
          
          <div>
            <h3 className="font-semibold text-white mb-4">Company</h3>
            <ul className="space-y-2">
              <li><a href="/about" onClick={handleClick('about')} className="hover:text-white cursor-pointer">About</a></li>
              <li><a href="/careers" onClick={handleClick('careers')} className="hover:text-white cursor-pointer">Careers</a></li>
              <li><a href="/blog" onClick={handleClick('blog')} className="hover:text-white cursor-pointer">Blog</a></li>
              <li><a href="/contact" onClick={handleClick('contact')} className="hover:text-white cursor-pointer">Contact</a></li>
            </ul>
          </div>
        </div>
        
        <div className="mt-12 pt-8 border-t border-gray-800 text-center text-gray-400">
          <p>&copy; {new Date().getFullYear()} Zapier Clone. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}