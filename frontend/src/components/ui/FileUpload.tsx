import { useRef, useState } from 'react'
import { Upload, FileText, X } from 'lucide-react'

interface Props {
  accept?: string
  label?: string
  // En el celular no se arrastra: otro texto (si no viene, el mismo label)
  labelCelular?: string
  hint?: string
  onFile: (file: File) => void
  // Optional: lets the parent show a file it restored itself, and hear about "Quitar"
  value?: File | null
  onClear?: () => void
  icon?: React.ReactNode
}

export default function FileUpload({
  accept = '*',
  label = 'Arrastrá el archivo acá',
  labelCelular,
  hint,
  onFile,
  value,
  onClear,
  icon,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [localFile, setFile] = useState<File | null>(null)
  const file = value !== undefined ? value : localFile

  function handleFile(f: File) {
    setFile(f)
    onFile(f)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation()
    setFile(null)
    if (inputRef.current) inputRef.current.value = ''
    onClear?.()
  }

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-6 md:p-8 text-center transition cursor-pointer bg-white ${
        dragging ? 'border-[#2D8D68] bg-[#E8F5EE]' : 'border-gray-300 hover:border-[#2D8D68]'
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={onInputChange}
      />
      {file ? (
        <div className="flex flex-col items-center gap-2">
          <FileText size={40} className="text-[#2D8D68]" />
          <p className="font-semibold text-gray-800 text-sm break-all">{file.name}</p>
          <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(0)} KB</p>
          <button
            onClick={clear}
            className="mt-1 min-h-10 md:min-h-0 px-2 flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
          >
            <X size={12} /> Quitar
          </button>
        </div>
      ) : (
        <>
          <div className="flex justify-center mb-3">
            {icon ?? <Upload size={48} className="text-gray-300" />}
          </div>
          {labelCelular ? (
            <>
              <p className="font-semibold text-gray-700 hidden md:block">{label}</p>
              <p className="font-semibold text-gray-700 md:hidden">{labelCelular}</p>
            </>
          ) : (
            <p className="font-semibold text-gray-700">{label}</p>
          )}
          {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
          <button
            className="mt-4 min-h-10 md:min-h-0 bg-[#2D8D68] hover:bg-[#1B5E4B] text-white font-medium px-5 md:px-4 py-2 rounded-lg text-sm md:text-xs transition-colors"
            onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}
          >
            Seleccionar archivo
          </button>
        </>
      )}
    </div>
  )
}
