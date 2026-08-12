<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, HandCoins } from '@lucide/vue'
import { useLending } from '../composables/useLending.js'
import { useSettings } from '../composables/useSettings.js'
import { formatCurrency } from '../utils/currency.js'
import { formatDate } from '../utils/date.js'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import { toast } from '@/components/ui/sonner/index.js'
import LoanFormModal from '../components/LoanFormModal.vue'

const router = useRouter()
const { settings } = useSettings()
const { loans, addLoan, deleteLoan, undoDelete, remaining, status, totalOutstanding } = useLending()

const modalOpen = ref(false)
const error = ref('')

const statusBadge = { paid: 'good', partial: 'warn', outstanding: 'secondary' }
const statusLabel = { paid: 'Paid', partial: 'Partially repaid', outstanding: 'Outstanding' }

function openAdd() {
  error.value = ''
  modalOpen.value = true
}

function handleSave(payload) {
  error.value = ''
  try {
    addLoan(payload)
    modalOpen.value = false
  } catch (e) {
    error.value = e.message
  }
}

function handleDelete(loan, event) {
  event.stopPropagation()
  deleteLoan(loan.id)
  toast('Loan deleted', {
    action: { label: 'Undo', onClick: () => undoDelete() },
  })
}

function isOverdue(loan) {
  return loan.dueDate && status(loan) !== 'paid' && new Date(loan.dueDate) < new Date()
}

const sortedLoans = computed(() => [...loans].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)))
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="font-display text-xl">Lending</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Money you've loaned out. Total outstanding: {{ formatCurrency(totalOutstanding(), settings.currencySymbol) }}
        </p>
      </div>
      <Button @click="openAdd"><Plus class="h-4 w-4" /> Add loan</Button>
    </div>

    <Card v-if="!sortedLoans.length">
      <CardContent class="p-8 text-center text-muted-foreground"> No loans yet. Track money you've given to someone here. </CardContent>
    </Card>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Card
        v-for="loan in sortedLoans"
        :key="loan.id"
        class="cursor-pointer transition-colors hover:border-primary"
        @click="router.push('/lending/' + loan.id)"
      >
        <CardContent class="flex flex-col gap-2 p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <HandCoins class="h-4 w-4 text-muted-foreground" />
              <strong>{{ loan.borrowerName }}</strong>
            </div>
            <Badge :variant="isOverdue(loan) ? 'over' : statusBadge[status(loan)]">
              {{ isOverdue(loan) ? 'Overdue' : statusLabel[status(loan)] }}
            </Badge>
          </div>
          <div class="amount text-lg font-semibold">{{ formatCurrency(remaining(loan), settings.currencySymbol) }}</div>
          <div class="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <span>of {{ formatCurrency(loan.amount, settings.currencySymbol) }} given {{ formatDate(loan.date, 'short') }}</span>
            <span v-if="loan.dueDate">Due {{ formatDate(loan.dueDate, 'short') }}</span>
          </div>
          <div class="mt-1 flex gap-2" @click.stop>
            <Button variant="destructive" size="sm" @click="(e) => handleDelete(loan, e)">Delete</Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <LoanFormModal :open="modalOpen" :loan="null" @close="modalOpen = false" @save="handleSave" />
    <p v-if="error" class="m-0 text-sm text-destructive">{{ error }}</p>
  </div>
</template>
