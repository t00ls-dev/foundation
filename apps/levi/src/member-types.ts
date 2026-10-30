// Contratos sem dependências de servidor, compartilhados pela API e interface.
export type MemberStatus = "Ativo" | "Inativo";
export const memberTextLimits = {
  name: 160,
  phone: 40,
  email: 254,
  address: 500,
  churchRole: 160,
} as const;
export interface MemberInput {
  churchId: string;
  name: string;
  status: MemberStatus;
  birthDate?: string | null;
  phone?: string | null;
  email?: string | null;
  joinedOn?: string | null;
  address?: string | null;
  baptismDate?: string | null;
  churchRole?: string | null;
}
export interface Member extends Required<MemberInput> {
  id: string;
  churchName: string;
  createdAt: string;
  version: number;
}
export interface MemberFilters {
  name?: string;
  churchId?: string;
  status?: MemberStatus;
  page?: number;
  pageSize?: number;
}
export interface MemberPage {
  churchId: string;
  members: Pick<Member, "id" | "name" | "churchId" | "churchName" | "status">[];
  page: number;
  pageSize: number;
  hasNext: boolean;
}
// Não usa Date nem fuso: valida estritamente uma data do calendário gregoriano.
export function isCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1]!
  );
}
export function formatCivilDate(value: string | null): string {
  return value ? value.split("-").reverse().join("/") : "Não informado";
}

export type MemberProfile = Pick<
  Required<MemberInput>,
  | "name"
  | "birthDate"
  | "phone"
  | "email"
  | "joinedOn"
  | "address"
  | "baptismDate"
  | "churchRole"
>;
export interface MemberEditInput extends MemberProfile {
  version: number;
}
