// The card in the bottom-right corner when an update is out (Ask first) or downloaded (Automatic).
import { X } from 'lucide-react'
import { closeCard, installOnClose, restartFromCard, skipVersion, updateNow, useUpdateCard } from '../updates'

export function UpdateCard() {
  const card = useUpdateCard((s) => s.card)
  if (!card) return null
  const title = card.kind === 'ready' ? `Argon ${card.version} is ready` : `Argon ${card.version} is out`
  return (
    <div className={`upd-card ${card.busy ? 'loading' : ''}`} role="status">
      <div className="upd-head">
        <b>{title}</b>
        <button className="icon-btn sm" title="Close" onClick={closeCard}>
          <X size={15} />
        </button>
      </div>
      <div className="upd-sub">{card.sub}</div>
      {card.notes && <div className="upd-notes">{card.notes}</div>}
      {card.pct != null && (
        <div className="upd-bar">
          <i style={{ width: `${card.pct}%` }} />
        </div>
      )}
      <div className="upd-btns">
        {card.kind === 'ready' ? (
          <>
            <button className="btn" disabled={card.busy} onClick={closeCard}>
              Later
            </button>
            <button className="btn primary" disabled={card.busy} onClick={restartFromCard}>
              Restart now
            </button>
          </>
        ) : (
          <>
            <button className="btn" disabled={card.busy} onClick={() => skipVersion(card.version)}>
              Skip this version
            </button>
            <button className="btn" disabled={card.busy} onClick={installOnClose}>
              When I close Argon
            </button>
            <button className="btn primary" disabled={card.busy} onClick={updateNow}>
              Update now
            </button>
          </>
        )}
      </div>
    </div>
  )
}
