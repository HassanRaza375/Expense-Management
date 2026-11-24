<script setup>
import { ref, computed } from 'vue'
import { Plus, ArrowLeftRight, Info, ChevronRight, ChevronDown, ArchiveRestore, Wallet, Landmark, Smartphone, CreditCard, Coins } from '@lucide/vue'
import { useAccounts } from '../composables/useAccounts.js'
import { useSettings } from '../composables/useSettings.js'
import { balanceText } from '../utils/accountsView.js'
import { formatDayKey } from '../utils/reporting.js'
import { formatCurrency } from '../utils/currency.js'
import AccountFormModal from '../components/AccountFormModal.vue'
import TransferFormModal from '../components/TransferFormModal.vue'
import { Card, CardContent } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Badge } from '@/components/ui/badge/index.js'
import { toast } from '@/components/ui/sonner/index.js'

const { cards, unassignedLine, addAccount, addTransfer, unarchiveAccount, archiveAccount } = useAccounts()
const { settings } = useSettings()

const ICONS = { cash: Coins, bank: Landmark, wallet: Smartphone, card: CreditCard, other: Wallet }
const money = (n) => formatCurrency(n, settings.currencySymbol).replace(/^-/, '−')

// Recomputed from the raw records whenever anything changes; nothing here is stored.
const view = computed(() => cards())
const unassigned = computed(() => unassignedLine())
const canTransfer = computed(() => view.value.activeCount >= 2)

const showArchived = ref(false)
const accountModal = ref(false)
const transferModal = ref(false)

function saveAccount(payload) {
  try {
    const a = addAccount(payload)
    accountModal.value = false
    toast(`Added ${a.name}`)
  } catch (e) {
    toast.error(e.message)
  }
}

function saveTransfer(payload) {
  try {
    addTransfer(payload)
    transferModal.value = false
    toast('Transfer added')
  } catch (e) {
    toast.error(e.message)
  }
}

function restore(card) {
  unarchiveAccount(card.id)
  toast(`${card.name} restored`, { action: { label: 'Undo', onClick: () => archiveAccount(card.id) } })
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <!-- Total + actions -->
    <Card>
      <CardContent class="flex flex-col gap-3 p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total across your accounts</div>
            <div class="amount text-3xl font-semibold" data-testid="accounts-total">{{ view.activeCount ? money(view.total) : money(0) }}</div>
            <div class="text-xs text-muted-foreground">{{ view.activeCount }} active {{ view.activeCount === 1 ? 'account' : 'accounts' }}. What you owe on a card is subtracted.</div>
          </div>
          <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button class="w-full sm:w-auto" data-testid="add-account" @click="accountModal = true"><Plus class="h-4 w-4" /> Add account</Button>
            <Button
              variant="outline"
              class="w-full sm:w-auto"
              :disabled="!canTransfer"
              :title="canTransfer ? 'Move money between two accounts' : 'You need two active accounts to transfer'"
              data-testid="open-transfer"
              @click="transferModal = true"
            >
              <ArrowLeftRight class="h-4 w-4" /> Transfer
            </Button>
          </div>
        </div>
        <p v-if="unassigned.text" class="m-0 flex gap-2 border-t border-border pt-3 text-sm" data-testid="unassigned-line">
          <Info class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span>
            {{ unassigned.text }}.
            <span class="text-muted-foreground">Records without an account never change a balance.</span>
            <RouterLink to="/expenses?account=none&cycle=all" class="ml-1 underline underline-offset-2" data-testid="review-unassigned">Review expenses</RouterLink>
          </span>
        </p>
      </CardContent>
    </Card>

    <!-- Empty state -->
    <Card v-if="!view.hasAccounts">
      <CardContent class="flex flex-col items-center gap-3 p-8 text-center">
        <Landmark class="h-8 w-8 text-muted-foreground" />
        <div class="font-medium">Add your first account</div>
        <p class="m-0 max-w-md text-sm text-muted-foreground">
          Accounts (cash, bank, mobile wallet, credit card) show where your money is. They are optional: your expenses, income and budget work exactly the same
          without them. Start with today's balance; you don't need to enter any history.
        </p>
        <Button data-testid="add-first-account" @click="accountModal = true"><Plus class="h-4 w-4" /> Add account</Button>
      </CardContent>
    </Card>

    <!-- Active accounts -->
    <div v-if="view.active.length" class="flex flex-col gap-2" data-testid="account-list">
      <RouterLink v-for="c in view.active" :key="c.id" :to="`/accounts/${c.id}`" class="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50" data-testid="account-card">
        <Card class="transition-colors hover:bg-accent/40">
          <CardContent class="flex items-center gap-3 p-4">
            <component :is="ICONS[c.type] || Wallet" class="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium">{{ c.name }}</div>
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>{{ c.typeLabel }}</span>
                <span>· from {{ formatDayKey(c.openingDate) }}</span>
                <Badge v-if="c.olderThanOpening" variant="warn">{{ c.olderThanOpening }} older</Badge>
              </div>
            </div>
            <div class="min-w-0 text-right">
              <template v-if="c.display">
                <div class="amount whitespace-nowrap text-lg font-semibold" data-testid="account-balance">{{ balanceText(c.display, money) }}</div>
                <div v-if="c.display.hint" class="max-w-40 text-xs text-status-warn">Negative: check for missing records</div>
              </template>
              <div v-else class="max-w-40 text-xs text-status-warn">{{ c.problem }}</div>
            </div>
            <ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </CardContent>
        </Card>
      </RouterLink>
    </div>

    <!-- Archived -->
    <div v-if="view.archived.length" class="flex flex-col gap-2">
      <button
        type="button"
        class="flex items-center gap-1 self-start rounded-md px-1 py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        :aria-expanded="showArchived"
        data-testid="toggle-archived"
        @click="showArchived = !showArchived"
      >
        <ChevronDown class="h-4 w-4 transition-transform" :class="showArchived ? '' : '-rotate-90'" />
        Archived ({{ view.archived.length }})
      </button>
      <template v-if="showArchived">
        <Card v-for="c in view.archived" :key="c.id" data-testid="archived-card">
          <CardContent class="flex flex-wrap items-center gap-3 p-4">
            <component :is="ICONS[c.type] || Wallet" class="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden="true" />
            <RouterLink :to="`/accounts/${c.id}`" class="min-w-0 flex-1 basis-32 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              <div class="truncate font-medium">{{ c.name }} <Badge variant="outline">Archived</Badge></div>
              <div class="text-xs text-muted-foreground">{{ c.typeLabel }}</div>
            </RouterLink>
            <div class="amount ml-auto whitespace-nowrap font-semibold">{{ balanceText(c.display, money) }}</div>
            <Button variant="outline" size="sm" @click="restore(c)"><ArchiveRestore class="h-4 w-4" /> Restore</Button>
          </CardContent>
        </Card>
        <p class="m-0 px-1 text-xs text-muted-foreground">Archived accounts are left out of the total and can't be used in new transfers. Their records are kept.</p>
      </template>
    </div>

    <AccountFormModal :open="accountModal" :account="null" @close="accountModal = false" @save="saveAccount" />
    <TransferFormModal :open="transferModal" :transfer="null" @close="transferModal = false" @save="saveTransfer" />
  </div>
</template>
