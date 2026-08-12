<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, HandCoins, Plus, Trash2, Pencil } from '@lucide/vue'
import { useLending } from '../composables/useLending.js'
import { useSettings } from '../composables/useSettings.js'
import { formatCurrency } from '../utils/currency.js'
import { formatDate } from '../utils/date.js'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import { toast } from '@/components/ui/sonner/index.js'
import StatCard from '../components/StatCard.vue'
import LoanFormModal from '../components/LoanFormModal.vue'
import RepaymentFormModal from '../components/RepaymentFormModal.vue'

const route = useRoute()
const router = useRouter()
const { settings } = useSettings()
const { findById, updateLoan, totalRepaid, remaining, status, addRepayment, deleteRepayment } = useLending()

const loan = computed(() => findById(route.params.id))

const statusBadge = { paid: 'good', partial: 'warn', outstanding: 'secondary' }
const statusLabel = { paid: 'Paid', partial: 'Partially repaid', outstanding: 'Outstanding' }

const sortedRepayments = computed(() => (loan.value ? [...loan.value.repayments].sort((a, b) => new Date(b.date) - new Date(a.date)) : []))

const editModalOpen = ref(false)
const repaymentModalOpen = ref(false)
const error = ref('')

function openEditLoan() {
  error.value = ''
  editModalOpen.value = true
}

function saveLoan(payload) {
  error.value = ''
  try {
    updateLoan(loan.value.id, payload)
    editModalOpen.value = false
  } catch (e) {
    error.value = e.message
  }
}

function openAddRepayment() {
  error.value = ''
  repaymentModalOpen.value = true
}

function saveRepayment(payload) {
  error.value = ''
  try {
    addRepayment(loan.value.id, payload)
    repaymentModalOpen.value = false
  } catch (e) {
    error.value = e.message
  }
}

function handleDeleteRepayment(repaymentId) {
  deleteRepayment(loan.value.id, repaymentId)
  toast('Repayment removed')
}
</script>

<template>
  <div v-if="!loan" class="flex flex-col items-center gap-3 p-14 text-center">
    <p class="text-muted-foreground">Loan not found.</p>
    <Button @click="router.push('/lending')">Back to Lending</Button>
  </div>

  <div v-else class="flex flex-col gap-4">
    <Button variant="ghost" size="sm" class="w-fit" @click="router.push('/lending')"><ArrowLeft class="h-4 w-4" /> Back to Lending</Button>

    <Card>
      <CardContent class="flex flex-wrap items-center justify-between gap-4 p-4">
        <div class="flex items-center gap-3">
          <HandCoins class="h-6 w-6 text-primary" />
          <div>
            <h2 class="font-display text-xl">{{ loan.borrowerName }}</h2>
            <p class="m-0 text-sm text-muted-foreground">
              Given {{ formatDate(loan.date, 'short') }}
              <span v-if="loan.dueDate"> · Due {{ formatDate(loan.dueDate, 'short') }}</span>
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Badge :variant="statusBadge[status(loan)]">{{ statusLabel[status(loan)] }}</Badge>
          <Button variant="outline" size="sm" @click="openEditLoan"><Pencil class="h-4 w-4" /> Edit</Button>
        </div>
      </CardContent>
    </Card>

    <section class="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <StatCard label="Amount given" :value="formatCurrency(loan.amount, settings.currencySymbol)" />
      <StatCard label="Repaid" :value="formatCurrency(totalRepaid(loan), settings.currencySymbol)" status="good" />
      <StatCard label="Remaining" :value="formatCurrency(remaining(loan), settings.currencySymbol)" :status="remaining(loan) > 0 ? 'warn' : 'good'" />
    </section>

    <p v-if="loan.notes" class="m-0 text-sm text-muted-foreground">{{ loan.notes }}</p>

    <div class="flex items-center justify-between">
      <h3 class="text-base font-semibold">Repayments</h3>
      <Button size="sm" :disabled="remaining(loan) <= 0" @click="openAddRepayment"><Plus class="h-4 w-4" /> Add repayment</Button>
    </div>

    <Card v-if="!sortedRepayments.length">
      <CardContent class="p-8 text-center text-muted-foreground"> No repayments yet. </CardContent>
    </Card>

    <Card v-else class="overflow-hidden py-0">
      <div v-for="r in sortedRepayments" :key="r.id" class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
        <div class="min-w-0 flex-1">
          <div class="font-medium">{{ formatDate(r.date, 'short') }}</div>
          <div v-if="r.notes" class="text-xs text-muted-foreground">{{ r.notes }}</div>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <div class="amount font-semibold text-status-good">{{ formatCurrency(r.amount, settings.currencySymbol) }}</div>
          <Button variant="ghost" size="icon" title="Delete" @click="handleDeleteRepayment(r.id)"><Trash2 class="h-4 w-4" /></Button>
        </div>
      </div>
    </Card>

    <LoanFormModal :open="editModalOpen" :loan="loan" @close="editModalOpen = false" @save="saveLoan" />
    <RepaymentFormModal :open="repaymentModalOpen" :max-amount="remaining(loan)" @close="repaymentModalOpen = false" @save="saveRepayment" />
    <p v-if="error" class="m-0 text-sm text-destructive">{{ error }}</p>
  </div>
</template>
