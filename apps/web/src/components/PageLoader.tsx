import styles from './PageLoader.module.css'

export function PageLoader() {
  return (
    <div className={styles.container} role="status" aria-label="로딩 중">
      <div className={styles.spinner} />
    </div>
  )
}
