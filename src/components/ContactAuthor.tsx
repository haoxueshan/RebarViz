'use client';

import { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import Image from 'next/image';

export function ContactAuthorButton({ collapsed = false }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={collapsed ? '联系作者' : undefined}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap text-gray-500 hover:bg-gray-100 hover:text-gray-800 w-full"
      >
        <MessageCircle className="w-5 h-5 shrink-0" />
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate">联系作者</div>
            <div className="text-[11px] truncate text-gray-400">微信二维码</div>
          </div>
        )}
      </button>

      {open && <ContactModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function ContactModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-xs w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
          aria-label="关闭"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <MessageCircle className="w-5 h-5 text-green-500" />
            <h3 className="text-lg font-bold text-gray-800">联系作者</h3>
          </div>

          <div className="rounded-xl overflow-hidden border border-gray-100 mb-4">
            <Image
              src="/wechat-qr-clean.jpg"
              alt="微信二维码"
              width={280}
              height={280}
              className="w-full h-auto"
            />
          </div>

          <p className="text-sm text-gray-500">
            微信扫码添加作者
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Bruce · Xi&apos;an, Shaanxi
          </p>
        </div>
      </div>
    </div>
  );
}
