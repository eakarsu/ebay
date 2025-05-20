import React from 'react';
import { Zap, Menu, X } from 'lucide-react';

export function Header() {
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);

  const handleSignUp = (e: React.MouseEvent) => {
    e.preventDefault();
    // Add your sign up logic here
    console.log('Sign up clicked');
  };

  const handleLogin = (e: React.MouseEvent) => {
    e.preventDefault();
    // Add your login logic here
    console.log('Login clicked');
  };

  const handleNavClick = (section: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    // Add your navigation logic here
    console.log(`Navigating to ${section}`);
    // You can add smooth scrolling to sections or navigation logic
    const element = document.getElementById(section);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <header className="bg-white border-b">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <a 
              href="/" 
              className="flex items-center space-x-2"
              onClick={(e) => {
                e.preventDefault();
                console.log('Home clicked');
              }}
            >
              <Zap className="h-8 w-8 text-purple-600" />
              <span className="text-xl font-bold">Zapier</span>
            </a>
            <nav className="hidden md:flex ml-8 space-x-6">
              <a href="#product" onClick={handleNavClick('product')} className="text-gray-600 hover:text-gray-900">Product</a>
              <a href="#solutions" onClick={handleNavClick('solutions')} className="text-gray-600 hover:text-gray-900">Solutions</a>
              <a href="#pricing" onClick={handleNavClick('pricing')} className="text-gray-600 hover:text-gray-900">Pricing</a>
              <a href="#integrations" onClick={handleNavClick('integrations')} className="text-gray-600 hover:text-gray-900">Integrations</a>
            </nav>
          </div>
          
          <div className="hidden md:flex items-center space-x-4">
            <a 
              href="/login" 
              onClick={handleLogin}
              className="text-gray-600 hover:text-gray-900 cursor-pointer"
            >
              Log in
            </a>
            <a 
              href="/signup" 
              onClick={handleSignUp}
              className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 cursor-pointer"
            >
              Sign up free
            </a>
          </div>

          <button 
            className="md:hidden p-2"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {isMenuOpen && (
        <div className="md:hidden">
          <div className="px-2 pt-2 pb-3 space-y-1">
            <a href="#product" onClick={handleNavClick('product')} className="block px-3 py-2 text-gray-600 hover:bg-gray-100 rounded">Product</a>
            <a href="#solutions" onClick={handleNavClick('solutions')} className="block px-3 py-2 text-gray-600 hover:bg-gray-100 rounded">Solutions</a>
            <a href="#pricing" onClick={handleNavClick('pricing')} className="block px-3 py-2 text-gray-600 hover:bg-gray-100 rounded">Pricing</a>
            <a href="#integrations" onClick={handleNavClick('integrations')} className="block px-3 py-2 text-gray-600 hover:bg-gray-100 rounded">Integrations</a>
            <a href="/login" onClick={handleLogin} className="block px-3 py-2 text-gray-600 hover:bg-gray-100 rounded">Log in</a>
            <a 
              href="/signup" 
              onClick={handleSignUp}
              className="block px-3 py-2 bg-purple-600 text-white rounded-lg text-center hover:bg-purple-700"
            >
              Sign up free
            </a>
          </div>
        </div>
      )}
    </header>
  );
}