'use client';

import { useState } from 'react';
import { motion } from 'motion/react';
import { Settings, Plug, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ERPConnector } from '@/components/workspace/ERPConnector';

type SettingsTab = 'integraciones' | 'preferencias';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('integraciones');

  const tabs: { key: SettingsTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'integraciones', label: 'Integraciones ERP', icon: Plug },
    { key: 'preferencias', label: 'Preferencias', icon: SlidersHorizontal },
  ];

  return (
    <div className="h-full overflow-y-auto styled-scrollbar">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0a0a0a] flex items-center justify-center">
              <Settings className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#0a0a0a]">Configuracion</h1>
              <p className="text-xs text-[#a3a3a3]">Conecte sus ERPs y configure la plataforma</p>
            </div>
          </div>
        </motion.div>

        {/* Tab Navigation */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25, delay: 0.04 }}
          className="flex gap-1 border-b border-[#e5e5e5]"
        >
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-xs font-medium transition-colors relative',
                  isActive
                    ? 'text-[#0a0a0a]'
                    : 'text-[#a3a3a3] hover:text-[#525252]',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
                {isActive && (
                  <motion.div
                    layoutId="settings-tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D4A017] rounded-full"
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  />
                )}
              </button>
            );
          })}
        </motion.div>

        {/* Tab Content */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25, delay: 0.08 }}
        >
          {activeTab === 'integraciones' && <ERPConnector />}
          {activeTab === 'preferencias' && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <SlidersHorizontal className="w-8 h-8 text-[#d4d4d4]" />
              <p className="text-sm text-[#a3a3a3]">Preferencias de la plataforma</p>
              <p className="text-xs text-[#d4d4d4]">Proximamente: idioma, moneda, formatos de exportacion</p>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
