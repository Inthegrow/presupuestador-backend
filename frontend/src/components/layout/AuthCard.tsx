import type { ReactNode } from 'react'

const SOLE_LOGO = (
  <svg width="48" height="48" viewBox="0 0 512 512" fill="none">
    <path
      d="M256 72C170.947 72 102 140.947 102 226C102 311.053 170.947 380 256 380C316.134 380 368.215 345.533 393.832 295.282"
      stroke="#E0A33A" strokeWidth="28" strokeLinecap="round"
    />
    <circle cx="390" cy="179" r="28" fill="#E0A33A" />
    <path
      d="M251 334V250C251 221.768 273.768 199 302 199H319"
      stroke="#143D34" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round"
    />
    <path d="M251 280C216.14 280 188 251.86 188 217V206C222.86 206 251 234.14 251 269V280Z" fill="#2D8D68" />
    <path d="M257 248C257 209.34 288.34 178 327 178H338C338 216.66 306.66 248 268 248H257Z" fill="#2D8D68" />
  </svg>
)

// Tarjeta de las pantallas de entrada (clave, empresa): mismo aspecto que el Login
export default function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#F5F6F8] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <div className="bg-[#143D34] px-8 py-8 flex flex-col items-center">
            {SOLE_LOGO}
            <div className="mt-4 text-center">
              <div className="text-white font-extrabold text-xl tracking-wide">SOLE</div>
              <div className="text-[#E0A33A] text-[10px] tracking-[0.3em] font-bold">IN THE GROW</div>
            </div>
            <div className="mt-3 text-center">
              <div className="text-white font-semibold text-sm">PRESUPUESTADOR PRO</div>
            </div>
          </div>
          <div className="px-8 py-6">
            <h2 className="font-bold text-gray-900 text-lg mb-1">{title}</h2>
            {subtitle && <p className="text-gray-500 text-sm mb-6">{subtitle}</p>}
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
