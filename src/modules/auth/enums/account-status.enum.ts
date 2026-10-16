export enum AccountStatusEnum {
  PENDING_ACTIVATION = 'pending_activation',
  ACTIVE = 'active',
  DEACTIVATED = 'deactivated',
}

export interface AccountStatusInterface {
  account_status: AccountStatusEnum | null;
}
