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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs/index.js'
import { toast } from '@/components/ui/sonner/index.js'
import LoanFormModal from '../components/LoanFormModal.vue'

const router = useRouter()
const { settings } = useSettings()
const { loansByDirection, addLoan, deleteLoan, undoDelete, remaining, status, totalOutstanding } = useLending()

const modalOpen = ref(false)
const modalDirection = ref('lent')
const error = ref('')

const statusBadge = { paid: 'good', partial: 'warn', outstanding: 'secondary' }
const statusLabel = { paid: 'Paid', partial: 'Partially repaid', outstanding: 'Outstanding' }

const lentLoans = computed(() => [...loansByDirection('lent')].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)))
const borrowedLoans = computed(() => [...loansByDirection('borrowed')].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)))

function openAdd(direction) {
  modalDirection.value = direction
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
  toast('Deleted', {
    action: { label: 'Undo', onClick: () => undoDelete() },
  })
}

function isOverdue(loan) {
  return loan.dueDate && status(loan) !== 'paid' && new Date(loan.dueDate) < new Date()
}

function personName(loan) {
  return loan.personName ?? loan.borrowerName ?? ''
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="font-display text-xl">Lending</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Owed to you: {{ formatCurrency(totalOutstanding('lent'), settings.currencySymbol) }} · You owe:
          {{ formatCurrency(totalOutstanding('borrowed'), settings.currencySymbol) }}
        </p>
      </div>
    </div>

    <Tabs default-value="lent">
      <TabsList>
        <TabsTrigger value="lent">Money I've lent</TabsTrigger>
        <TabsTrigger value="borrowed">Money I've borrowed</TabsTrigger>
      </TabsList>

      <TabsContent value="lent" class="flex flex-col gap-4">
        <div class="flex justify-end">
          <Button @click="openAdd('lent')"><Plus class="h-4 w-4" /> Add loan</Button>
        </div>

        <Card v-if="!lentLoans.length">
          <CardContent class="p-8 text-center text-muted-foreground"> No loans yet. Track money you've given to someone here. </CardContent>
        </Card>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card
            v-for="loan in lentLoans"
            :key="loan.id"
            class="cursor-pointer transition-colors hover:border-primary"
            @click="router.push('/lending/' + loan.id)"
          >
            <CardContent class="flex flex-col gap-2 p-4">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <HandCoins class="h-4 w-4 text-muted-foreground" />
                  <strong>{{ personName(loan) }}</strong>
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
      </TabsContent>

      <TabsContent value="borrowed" class="flex flex-col gap-4">
        <div class="flex justify-end">
          <Button @click="openAdd('borrowed')"><Plus class="h-4 w-4" /> Add borrowing</Button>
        </div>

        <Card v-if="!borrowedLoans.length">
          <CardContent class="p-8 text-center text-muted-foreground"> No borrowing recorded. Track money someone has given you here. </CardContent>
        </Card>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card
            v-for="loan in borrowedLoans"
            :key="loan.id"
            class="cursor-pointer transition-colors hover:border-primary"
            @click="router.push('/lending/' + loan.id)"
          >
            <CardContent class="flex flex-col gap-2 p-4">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <HandCoins class="h-4 w-4 text-muted-foreground" />
                  <strong>{{ personName(loan) }}</strong>
                </div>
                <Badge :variant="isOverdue(loan) ? 'over' : statusBadge[status(loan)]">
                  {{ isOverdue(loan) ? 'Overdue' : statusLabel[status(loan)] }}
                </Badge>
              </div>
              <div class="amount text-lg font-semibold">{{ formatCurrency(remaining(loan), settings.currencySymbol) }}</div>
              <div class="flex flex-col gap-0.5 text-xs text-muted-foreground">
                <span>of {{ formatCurrency(loan.amount, settings.currencySymbol) }} borrowed {{ formatDate(loan.date, 'short') }}</span>
                <span v-if="loan.dueDate">Due {{ formatDate(loan.dueDate, 'short') }}</span>
              </div>
              <div class="mt-1 flex gap-2" @click.stop>
                <Button variant="destructive" size="sm" @click="(e) => handleDelete(loan, e)">Delete</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>
    </Tabs>

    <LoanFormModal :open="modalOpen" :loan="null" :direction="modalDirection" @close="modalOpen = false" @save="handleSave" />
    <p v-if="error" class="m-0 text-sm text-destructive">{{ error }}</p>
  </div>
</template>
