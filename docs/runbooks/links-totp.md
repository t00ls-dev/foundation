# TOTP no Links

## Alcance e gerenciamento

TOTP protege **login por senha**, não todos os acessos à conta. Magic Link e
Google continuam alternativas sem challenge TOTP do Links, inclusive durante
lockout. Sessões existentes não recebem MFA retroativo. Não há recovery codes,
OTP, trusted devices ou reset administrativo de MFA.

Em Account → Authenticator:

1. Em Security, Authenticator mostra **Off → Set up** ou **On → Turn off**;
   status desconhecido nunca vira Off. Use Set up e informe a senha atual no
   Dialog. Quem ainda não possui senha usa o fluxo por e-mail de Password
   primeiro.
2. Escaneie o QR gerado localmente por `qrcode` ou informe o setup key
   manualmente no app autenticador. Issuer é `Links`, seis dígitos e período de
   30 segundos.
3. Confirme um código atual. A conclusão aparece somente após reconciliação
   autoritativa; Done fecha o Dialog. Setup pendente não protege login antes de
   confirmar.
4. Para desativar, use **Turn off** com a senha atual no mesmo padrão de Dialog.
   A operação nativa rotaciona esta sessão, sem revogação global das outras
   sessões.

Enrollment está liberado no app junto com o cliente completo. Os guards do
backend existente continuam bloqueando backup/OTP e `trustDevice: true`. Nenhuma
nova migration ou mudança em pacote publicável foi necessária nesta etapa;
`0003_links_totp.sql` já fornece a persistência.

QR/key permanecem apenas em estado transitório do componente. A URI existe
apenas durante a geração local do PNG, sem serviço externo, URL de navegação,
storage, download, analytics ou clipboard automático. Cancelamento, saída da
rota, troca/rotação de sessão e restauração de bfcache descartam o setup e os
inputs sensíveis. Abortar um request não garante rollback no servidor. Um setup
pendente abandonado pode ser substituído iniciando enrollment novamente.

QR é primário; **Can't scan? Use setup key** revela a key em Collapsible. A key
não existe no DOM textual enquanto oculta. **Copy** copia o secret original sem
espaços; Copied aparece somente após sucesso da Clipboard API. Falha permite
seleção/cópia manual. Fechar não tenta apagar o clipboard.

## Login com senha

`twoFactorRedirect` nunca é interpretado como login concluído. O cliente guarda
apenas email esperado/destino validado/disponibilidade do challenge em memória
da SPA e abre `/two-factor`. Senha e códigos não entram nesse contexto. O
destino `next` usa a allowlist privada existente; nenhuma URI/secret entra em
history.

Antes do código, o challenge não dá acesso privado. Código incorreto/fora da
janela permite nova tentativa manual; challenge expirado/usado/budget esgotado
exige novo login por senha. Lockout de conta informa a espera de quinze minutos
e as alternativas; rate limit HTTP informa espera sem confundir com lockout. Um
challenge sem método TOTP disponível indica setup incompleto, não login válido.
Refresh ou saída da página descarta a identidade em memória e exige novo login,
em vez de confiar somente no cookie de challenge. O prazo nativo é dez minutos.

## Sessão autoritativa e estados indeterminados

Todos os requests TOTP usam as APIs públicas do Better Auth, `retry: 0` e
`disableSignal: true` público. Assim, a atualização automática do cliente não
invalida o request ainda em reconciliação. Depois do HTTP, `getSession` com
`disableCookieCache`/`disableRefresh` confirma identidade e estado esperados;
snapshot/token/user antigo do body de confirmação não representa a sessão final.
O request concluído é liberado da geração antes do refresh legítimo da sessão.

Falha inesperada, rede ou `AUTH_STATE_INDETERMINATE` não prova sucesso nem
falha: campos e QR/key são descartados, mutations não se repetem automaticamente
e não se anuncia confirmação/rollback. **Check authenticator status** e **Check
current session** são leituras explícitas, não retries da mutation. Uma sessão
ativa de outro email nunca conclui o challenge da identidade esperada.

Para recuperar acesso, use Magic Link/Google; se ainda autenticado, é possível
**Finish interrupted setup** com senha (URI pública protegida) e novo código, ou
desativar explicitamente com senha para terminar cleanup. O flag On sozinho não
comprova setup íntegro após falha. Password reset não remove TOTP. Não há
promessa de transação global, cleanup de sessões órfãs ou uso único global de
código por janela.

Recovery não aparece na leitura normal. Erro indeterminado/setup excepcional ou
challenge sem método disponível habilita essa ajuda contextual. A observação é
mantida no estado da SPA e num marcador de `sessionStorage` desta aba para o
email esperado, para sobreviver ao redirect completo de Magic Link/Google. O
marcador nunca contém credentials/secret/código, nem comprova sessão, flag ou
integridade; não aparece para outro email. Não há query nova; é descartado em
logout ou conclusão confirmada. Se storage estiver indisponível, resta o
contexto da SPA. Ler um flag On/Off não elimina a incerteza nem comprova
integridade após falha parcial.

## Validação

`e2e/totp.spec.ts` usa Worker/D1 e APIs públicas para identidades, setup, sessão
e e-mails; QR/key são os dados públicos necessários ao enrollment. Códigos
derivam da key por referência RFC 6238 independente. Não há SQL para preparar
estado TOTP funcional. Transporte simulado cobre respostas perdidas, identidades
divergentes e erros, mantendo o fluxo saudável em D1 real.
Trace/video/screenshot foram desabilitados somente nessa suíte com secrets
efêmeros; não há redução de cenários ou alteração de retries/timeouts.

```sh
pnpm --filter @t00ls-dev/example-links test
pnpm --filter @t00ls-dev/example-links test:integration
pnpm --filter @t00ls-dev/example-links exec playwright test e2e/totp.spec.ts
```

O gate final permanece `pnpm check`. Merge, release/publicação e deploy remoto
continuam operações separadas que exigem autorização.
