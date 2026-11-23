<script setup>
import { reactive, ref, onUnmounted } from 'vue'
import { Lock, Landmark, CreditCard, IdCard, TrendingUp, Trash2, Plus } from '@lucide/vue'
import { useVault } from '../composables/useVault.js'
import { formatCurrency } from '../utils/currency.js'
import { useSettings } from '../composables/useSettings.js'
import { accountsEnabled } from '../composables/useAccount'
import MaskedField from '../components/MaskedField.vue'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card/index.js'
import { Button } from '@/components/ui/button/index.js'
import { Input } from '@/components/ui/input/index.js'
import { Label } from '@/components/ui/label/index.js'

const vault = useVault()
const { settings } = useSettings()

const accountsOn = accountsEnabled()
const passphrase = ref('')
const confirmPassphrase = ref('')
const error = ref('')

async function submitPassphrase() {
  error.value = ''
  if (!vault.session.isSetUp) {
    if (passphrase.value.length < 4) {
      error.value = 'Passphrase must be at least 4 characters'
      return
    }
    if (passphrase.value !== confirmPassphrase.value) {
      error.value = 'Passphrases do not match'
      return
    }
    await vault.setupPassphrase(passphrase.value)
  } else {
    const ok = await vault.unlock(passphrase.value)
    if (!ok) error.value = 'Incorrect passphrase'
  }
  passphrase.value = ''
  confirmPassphrase.value = ''
}

onUnmounted(() => {
  vault.lock()
})

// --- Bank accounts ---
const bankForm = reactive({ bankName: '', accountTitle: '', accountNumber: '', iban: '', branch: '' })
function submitBank() {
  if (!bankForm.bankName) return
  vault.addBankAccount({ ...bankForm })
  Object.keys(bankForm).forEach((k) => (bankForm[k] = ''))
}

// --- Cards ---
const cardForm = reactive({ network: '', nickname: '', last4: '', expiry: '' })
function submitCard() {
  if (!cardForm.last4) return
  vault.addCard({ ...cardForm })
  Object.keys(cardForm).forEach((k) => (cardForm[k] = ''))
}

// --- CNIC ---
const cnicForm = reactive({ number: '', expiry: '', issuingInfo: '' })
function loadCnic() {
  Object.assign(cnicForm, vault.session.data.cnic)
}
function saveCnic() {
  vault.updateCnic({ ...cnicForm })
}

// --- Investments ---
const investForm = reactive({ type: '', name: '', amountInvested: '', currentValue: '', notes: '' })
function submitInvestment() {
  if (!investForm.name) return
  vault.addInvestment({
    ...investForm,
    amountInvested: Number(investForm.amountInvested) || 0,
    currentValue: Number(investForm.currentValue) || 0,
  })
  Object.keys(investForm).forEach((k) => (investForm[k] = ''))
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <Card v-if="!vault.session.isUnlocked" class="mx-auto mt-8 w-full max-w-md">
      <CardHeader class="items-center text-center">
        <Lock class="mb-1 h-8 w-8 text-primary" />
        <CardTitle>{{ vault.session.isSetUp ? 'Unlock Vault' : 'Set up your Vault' }}</CardTitle>
        <CardDescription>
          Separate from your app password. Data is encrypted with AES-GCM and only decrypted in memory while this view is open.
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <Label>Passphrase</Label>
          <Input v-model="passphrase" type="password" @keyup.enter="submitPassphrase" />
        </div>
        <div v-if="!vault.session.isSetUp" class="flex flex-col gap-1.5">
          <Label>Confirm passphrase</Label>
          <Input v-model="confirmPassphrase" type="password" @keyup.enter="submitPassphrase" />
        </div>
        <p v-if="error" class="m-0 text-sm text-destructive">{{ error }}</p>
        <Button class="w-full" @click="submitPassphrase">{{ vault.session.isSetUp ? 'Unlock' : 'Create Vault' }}</Button>
        <p class="m-0 text-xs text-muted-foreground" data-testid="vault-warning">
          Your passphrase is never saved or sent anywhere. If you lose it, nobody can recover the Vault, not even the person who runs this service.
          <template v-if="accountsOn">With an account, the Vault is kept in your account only as the encrypted text it already is.</template>
        </p>
      </CardContent>
    </Card>

    <template v-else>
      <Card>
        <CardHeader><CardTitle class="flex items-center gap-2 text-base"><Landmark class="h-4 w-4" /> Bank accounts</CardTitle></CardHeader>
        <CardContent class="flex flex-col gap-2">
          <div v-for="acc in vault.session.data.bankAccounts" :key="acc.id" class="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2 last:border-b-0">
            <div>
              <strong>{{ acc.bankName }}</strong> — {{ acc.accountTitle }}
              <div class="text-sm text-muted-foreground">{{ acc.branch }}</div>
            </div>
            <MaskedField :value="acc.accountNumber || acc.iban" />
            <Button variant="ghost" size="icon" @click="vault.deleteBankAccount(acc.id)"><Trash2 class="h-4 w-4" /></Button>
          </div>
          <div class="mt-2 flex flex-wrap gap-2">
            <Input v-model="bankForm.bankName" placeholder="Bank name" class="min-w-32 flex-1" />
            <Input v-model="bankForm.accountTitle" placeholder="Account title" class="min-w-32 flex-1" />
            <Input v-model="bankForm.accountNumber" placeholder="Account number" class="min-w-32 flex-1" />
            <Input v-model="bankForm.iban" placeholder="IBAN" class="min-w-32 flex-1" />
            <Input v-model="bankForm.branch" placeholder="Branch" class="min-w-32 flex-1" />
            <Button size="sm" @click="submitBank"><Plus class="h-4 w-4" /> Add</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle class="flex items-center gap-2 text-base"><CreditCard class="h-4 w-4" /> Cards</CardTitle></CardHeader>
        <CardContent class="flex flex-col gap-2">
          <div v-for="card in vault.session.data.cards" :key="card.id" class="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2 last:border-b-0">
            <div><strong>{{ card.network }}</strong> — {{ card.nickname }}</div>
            <MaskedField :value="card.last4" :visible-tail="4" />
            <Button variant="ghost" size="icon" @click="vault.deleteCard(card.id)"><Trash2 class="h-4 w-4" /></Button>
          </div>
          <div class="mt-2 flex flex-wrap gap-2">
            <Input v-model="cardForm.network" placeholder="Network (Visa/Master)" class="min-w-32 flex-1" />
            <Input v-model="cardForm.nickname" placeholder="Nickname" class="min-w-32 flex-1" />
            <Input v-model="cardForm.last4" placeholder="Last 4 digits" maxlength="4" class="min-w-32 flex-1" />
            <Input v-model="cardForm.expiry" placeholder="MM/YY" class="min-w-32 flex-1" />
            <Button size="sm" @click="submitCard"><Plus class="h-4 w-4" /> Add</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle class="flex items-center gap-2 text-base"><IdCard class="h-4 w-4" /> CNIC</CardTitle></CardHeader>
        <CardContent>
          <div class="flex flex-wrap gap-2" @focusin="loadCnic">
            <Input v-model="cnicForm.number" placeholder="CNIC number" class="min-w-32 flex-1" />
            <Input v-model="cnicForm.expiry" type="date" class="min-w-32 flex-1" />
            <Input v-model="cnicForm.issuingInfo" placeholder="Issuing info" class="min-w-32 flex-1" />
            <Button size="sm" @click="saveCnic">Save</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle class="flex items-center gap-2 text-base"><TrendingUp class="h-4 w-4" /> Investments</CardTitle></CardHeader>
        <CardContent class="flex flex-col gap-2">
          <div v-for="inv in vault.session.data.investments" :key="inv.id" class="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2 last:border-b-0">
            <div><strong>{{ inv.name }}</strong> — {{ inv.type }}</div>
            <span class="amount">{{ formatCurrency(inv.currentValue, settings.currencySymbol) }}</span>
            <Button variant="ghost" size="icon" @click="vault.deleteInvestment(inv.id)"><Trash2 class="h-4 w-4" /></Button>
          </div>
          <div class="mt-2 flex flex-wrap gap-2">
            <Input v-model="investForm.name" placeholder="Name" class="min-w-32 flex-1" />
            <Input v-model="investForm.type" placeholder="Type" class="min-w-32 flex-1" />
            <Input v-model="investForm.amountInvested" type="number" placeholder="Invested" class="min-w-32 flex-1" />
            <Input v-model="investForm.currentValue" type="number" placeholder="Current value" class="min-w-32 flex-1" />
            <Button size="sm" @click="submitInvestment"><Plus class="h-4 w-4" /> Add</Button>
          </div>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
