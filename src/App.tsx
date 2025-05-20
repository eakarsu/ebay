import React from 'react';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { IntegrationGrid } from './components/IntegrationGrid';
import { PricingSection } from './components/PricingSection';
import { Footer } from './components/Footer';

function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <Hero />
      <IntegrationGrid />
      <PricingSection />
      <Footer />
    </div>
  );
}

export default App;