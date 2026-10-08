import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from '~/api/client'
import type { Customer } from '@beautypost/shared'
import styles from './CustomersPage.module.css'

export default function CustomersPage() {
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['customers', search],
    queryFn: () =>
      api.get<{ data: Customer[] }>(`/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`)
        .then((r) => r.data),
  })

  const addMut = useMutation({
    mutationFn: () => api.post('/customers', { name: newName, phone: newPhone }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] })
      setShowAdd(false)
      setNewName('')
      setNewPhone('')
    },
  })

  const customers = data ?? []

  return (
    <div className="page-scroll">
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>고객 관리</h1>
          <button className={styles.addBtn} onClick={() => setShowAdd(true)}>+ 추가</button>
        </div>

        <div className={styles.searchWrap}>
          <input
            className={styles.search}
            placeholder="이름으로 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {showAdd && (
          <div className={styles.addForm}>
            <input
              className={styles.input}
              placeholder="이름 *"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
            <input
              className={styles.input}
              placeholder="연락처 (선택)"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              type="tel"
            />
            <div className={styles.formActions}>
              <button className={styles.cancelBtn} onClick={() => setShowAdd(false)}>취소</button>
              <button
                className={styles.saveBtn}
                onClick={() => addMut.mutate()}
                disabled={!newName.trim() || addMut.isPending}
              >
                저장
              </button>
            </div>
          </div>
        )}

        <div className={styles.list}>
          {customers.map((c) => (
            <Link key={c.id} to="/customers/$customerId" params={{ customerId: c.id }} className={styles.customerCard}>
              <div className={styles.avatar}>{c.name[0]}</div>
              <div className={styles.info}>
                <p className={styles.name}>{c.name}</p>
                <p className={styles.meta}>
                  방문 {c.visitCount}회
                  {c.lastVisitAt && ` · ${new Date(c.lastVisitAt).toLocaleDateString('ko', { month: 'short', day: 'numeric' })} 마지막 방문`}
                </p>
                {c.tags.length > 0 && (
                  <div className={styles.tags}>
                    {c.tags.slice(0, 3).map((t, i) => <span key={i} className={styles.tag}>{t}</span>)}
                  </div>
                )}
              </div>
              <span className={styles.arrow}>›</span>
            </Link>
          ))}
          {customers.length === 0 && (
            <div className={styles.empty}>
              <p>고객이 없어요</p>
              <button className={styles.emptyBtn} onClick={() => setShowAdd(true)}>첫 고객 추가하기</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
