import React from 'react';
import { Clock, Heart } from 'lucide-react';
import { Product } from '../types';

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
      <img 
        src={product.image} 
        alt={product.title}
        className="w-full h-48 object-cover"
      />
      <div className="p-4">
        <h3 className="text-lg font-semibold text-gray-800 hover:text-blue-600 truncate">
          {product.title}
        </h3>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-2xl font-bold text-gray-900">
            ${product.price.toFixed(2)}
          </span>
          <span className="text-sm text-gray-500 capitalize">
            {product.condition}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
          <span>{product.bids} bids</span>
          <div className="flex items-center gap-1">
            <Clock size={14} />
            {product.timeLeft}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm text-gray-500">
            Seller: {product.seller}
          </span>
          <button className="text-gray-400 hover:text-red-500 transition-colors">
            <Heart size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}