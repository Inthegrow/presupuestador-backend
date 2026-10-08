// El logo de SOLE (la hoja y el sol), del tamaño que pida cada lugar
export default function LogoSole({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="none" aria-hidden="true">
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
}
