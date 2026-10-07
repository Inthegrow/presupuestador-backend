import { useState, useRef, useEffect } from 'react'
import { ChevronRight, ChevronDown, Pencil, Trash2, Check, X } from 'lucide-react'
import type { TreeNode } from '../../types'

interface Props {
  nodes: TreeNode[]
  selectedId?: string
  onSelect: (node: TreeNode) => void
  onEditSection?: (node: TreeNode, newName: string) => void
  onDeleteSection?: (node: TreeNode) => void
  depth?: number
}

interface ItemProps {
  node: TreeNode
  selectedId?: string
  onSelect: (node: TreeNode) => void
  onEditSection?: (node: TreeNode, newName: string) => void
  onDeleteSection?: (node: TreeNode) => void
  depth: number
}

function TreeItem({ node, selectedId, onSelect, onEditSection, onDeleteSection, depth }: ItemProps) {
  const children: TreeNode[] = (node.children ?? []) as TreeNode[]
  const hasChildren = children.length > 0
  const [open, setOpen] = useState(depth === 0)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(node.description ?? '')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const isSelected = node.id === selectedId
  const isSection = depth === 0 && node.notas === 'Seccion'
  const isEmptySection = isSection && children.length === 0

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditValue(node.description ?? '')
    setEditing(true)
  }

  const handleSaveEdit = () => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== node.description && onEditSection) {
      onEditSection(node, trimmed)
    }
    setEditing(false)
  }

  const handleCancelEdit = () => {
    setEditing(false)
    setEditValue(node.description ?? '')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSaveEdit()
    if (e.key === 'Escape') handleCancelEdit()
  }

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowDeleteConfirm(true)
  }

  const handleConfirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onDeleteSection) onDeleteSection(node)
    setShowDeleteConfirm(false)
  }

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowDeleteConfirm(false)
  }

  const isTopLevel = depth === 0

  return (
    <div>
      <div
        className={`group flex items-center gap-1.5 px-2 py-2 rounded-lg cursor-pointer text-xs transition-all duration-200 relative ${
          isSelected
            ? 'bg-[#E8F5EE] text-[#143D34] font-semibold shadow-sm'
            : isTopLevel
              ? 'text-gray-700 hover:bg-gray-50'
              : 'text-gray-500 hover:bg-gray-50'
        }`}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        onClick={() => {
          if (!editing) {
            onSelect(node)
          }
        }}
      >
        {/* Selected indicator bar */}
        {isSelected && (
          <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-[#2D8D68]" />
        )}

        {hasChildren ? (
          <span
            className={`flex-shrink-0 transition-transform duration-200 cursor-pointer ${isSelected ? 'text-[#2D8D68]' : 'text-gray-400'}`}
            onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}

        {depth > 0 && node.code && (
          <span className="font-mono text-[10px] text-gray-400 mr-0.5 bg-gray-100 px-1 py-0.5 rounded">
            {node.code}
          </span>
        )}

        {editing ? (
          <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 min-w-0 px-1.5 py-0.5 text-xs border border-[#2D8D68] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#2D8D68]/30"
            />
            <button
              onClick={handleSaveEdit}
              className="p-0.5 text-[#2D8D68] hover:bg-[#E8F5EE] rounded"
              title="Guardar"
            >
              <Check size={12} />
            </button>
            <button
              onClick={handleCancelEdit}
              className="p-0.5 text-gray-400 hover:bg-gray-100 rounded"
              title="Cancelar"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <>
            <span className={`truncate flex-1 ${isTopLevel ? 'font-semibold text-[12px]' : 'text-[11px]'}`}>
              {node.description ?? '(sin nombre)'}
            </span>
            {hasChildren && isTopLevel && (
              <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full font-medium tabular-nums">
                {children.length}
              </span>
            )}
            {isSection && (
              <span className="hidden group-hover:flex items-center gap-0.5 ml-1 flex-shrink-0">
                {onEditSection && (
                  <button
                    onClick={handleStartEdit}
                    className="p-0.5 text-gray-400 hover:text-[#2D8D68] hover:bg-[#E8F5EE] rounded transition-colors"
                    title="Cambiar el nombre del rubro" aria-label="Cambiar el nombre del rubro"
                  >
                    <Pencil size={11} />
                  </button>
                )}
                {onDeleteSection && isEmptySection && (
                  <button
                    onClick={handleDeleteClick}
                    className="p-0.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    title="Borrar el rubro (está vacío)" aria-label="Borrar el rubro"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </span>
            )}
          </>
        )}
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="mx-2 my-1 p-2 bg-red-50 border border-red-200 rounded-lg text-[11px]">
          <p className="text-red-700 mb-1.5">¿Borrar el rubro "{node.description}"?</p>
          <div className="flex gap-1.5">
            <button
              onClick={handleConfirmDelete}
              className="px-2 py-0.5 bg-red-500 text-white rounded-lg text-[10px] font-medium hover:bg-red-600 transition-colors"
            >
              Borrar
            </button>
            <button
              onClick={handleCancelDelete}
              className="px-2 py-0.5 bg-white border border-gray-300 text-gray-600 rounded-lg text-[10px] font-medium hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {hasChildren && open && (
        <div className="tree-children-enter">
          {children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              onEditSection={onEditSection}
              onDeleteSection={onDeleteSection}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function TreeView({ nodes, selectedId, onSelect, onEditSection, onDeleteSection, depth = 0 }: Props) {
  return (
    <div className="space-y-0.5 text-xs">
      {nodes.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          selectedId={selectedId}
          onSelect={onSelect}
          onEditSection={onEditSection}
          onDeleteSection={onDeleteSection}
          depth={depth}
        />
      ))}
    </div>
  )
}
