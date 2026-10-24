import type { PresetCatalog } from '~/api/content'
import type { Choices } from './types'
import styles from './create.module.css'

interface Props {
  presets: PresetCatalog
  choices: Choices
  set: (patch: Partial<Choices>) => void
}

export default function StepPurpose({ presets, choices, set }: Props) {
  return (
    <>
      <p className={styles.sectionLabel}>업종</p>
      <div className={styles.chips}>
        {presets.industries.map((ind) => (
          <button
            key={ind.id}
            type="button"
            className={`${styles.chip} ${choices.industry === ind.id ? styles.chipOn : ''}`}
            onClick={() => set({ industry: ind.id })}
          >
            {ind.label}
          </button>
        ))}
      </div>

      <p className={styles.sectionLabel}>어떤 콘텐츠인가요?</p>
      <div className={styles.cardGrid}>
        {presets.purposes.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`${styles.optionCard} ${choices.purpose === p.id ? styles.optionOn : ''}`}
            onClick={() => set({ purpose: p.id })}
          >
            <span className={styles.optionTitle}>{p.label}</span>
            <span className={styles.optionDesc}>{p.description}</span>
          </button>
        ))}
      </div>
    </>
  )
}
