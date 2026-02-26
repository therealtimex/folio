import { useState, useRef } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { ShieldCheck, Database, Check, Trash2, Mail, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useApp } from '../../context/AppContext';
import { api } from '../../lib/api';
import { toast } from '../Toast';
import { LoadingSpinner } from '../LoadingSpinner';
import { EmailAccount } from '../../lib/types';
import { ImapConnectModal } from '../ImapConnectModal';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../ui/dialog';

export function MailSourcesTab({ localSettings, setLocalSettings, handleSaveSettings, savingSettings }: any) {
    const { state, actions, supabase } = useApp();
    const { t } = useLanguage();

    const [showGmailModal, setShowGmailModal] = useState(false);
    const [gmailModalStep, setGmailModalStep] = useState<'credentials' | 'code'>('credentials');
    const [credentialsJson, setCredentialsJson] = useState('');
    const [gmailClientId, setGmailClientId] = useState('');
    const [gmailClientSecret, setGmailClientSecret] = useState('');
    const [gmailAuthCode, setGmailAuthCode] = useState('');
    const [savingCredentials, setSavingCredentials] = useState(false);
    const [connectingGmail, setConnectingGmail] = useState(false);

    const [showOutlookModal, setShowOutlookModal] = useState(false);
    const [outlookModalStep, setOutlookModalStep] = useState<'credentials' | 'device-code'>('credentials');
    const [outlookClientId, setOutlookClientId] = useState('');
    const [outlookTenantId, setOutlookTenantId] = useState('');
    const [savingOutlookCredentials, setSavingOutlookCredentials] = useState(false);
    const [outlookDeviceCode, setOutlookDeviceCode] = useState<any>(null);
    const [isOutlookConnecting, setIsOutlookConnecting] = useState(false);

    const [showImapModal, setShowImapModal] = useState(false);
    const [byokExpanded, setByokExpanded] = useState(false);
    const credentialsRef = useRef<HTMLDivElement>(null);

    const handleConnectGmail = () => {
        setGmailModalStep('credentials');
        setCredentialsJson('');
        setGmailClientId('');
        setGmailClientSecret('');
        setGmailAuthCode('');
        setShowGmailModal(true);
    };

    const handleCredentialsJsonChange = (json: string) => {
        setCredentialsJson(json);
        try {
            const parsed = JSON.parse(json);
            const creds = parsed.installed || parsed.web || parsed;
            if (creds.client_id) setGmailClientId(creds.client_id);
            if (creds.client_secret) setGmailClientSecret(creds.client_secret);
        } catch { }
    };

    const handleSaveAndConnect = async () => {
        if (!gmailClientId || !gmailClientSecret) {
            toast.error(t('config.toast.missingGmailCreds'));
            return;
        }

        setSavingCredentials(true);
        try {
            const success = await actions.updateSettings({
                google_client_id: gmailClientId,
                google_client_secret: gmailClientSecret,
            });

            if (success) {
                const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
                const response = await api.getGmailAuthUrl(gmailClientId, gmailClientSecret, token);
                if (response.data?.authUrl) {
                    window.open(response.data.authUrl, '_blank');
                    setGmailModalStep('code');
                    toast.success(t('config.toast.authorizeAndPaste'));
                } else {
                    toast.error(t('config.toast.oauthUrlFailed'));
                }
            } else {
                toast.error(t('config.toast.saveCredsFailed'));
            }
        } catch (error) {
            toast.error(t('config.toast.saveCredsFailed'));
        } finally {
            setSavingCredentials(false);
        }
    };

    const handleSubmitAuthCode = async () => {
        if (!gmailAuthCode.trim()) {
            toast.error(t('config.toast.missingAuthCode'));
            return;
        }

        setConnectingGmail(true);
        try {
            const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
            const response = await api.connectGmail(gmailAuthCode.trim(), gmailClientId, gmailClientSecret, token);
            if (response.data?.success) {
                toast.success(t('config.toast.gmailConnected'));
                setShowGmailModal(false);
                actions.fetchAccounts();
            } else {
                toast.error(t('config.toast.gmailConnectFailed'));
            }
        } catch (error) {
            toast.error(t('config.toast.gmailConnectFailed'));
        } finally {
            setConnectingGmail(false);
        }
    };

    const handleConnectOutlook = () => {
        setOutlookModalStep('credentials');
        setOutlookClientId('');
        setOutlookTenantId('');
        setShowOutlookModal(true);
    };

    const handleSaveOutlookAndConnect = async () => {
        if (!outlookClientId) {
            toast.error(t('config.toast.missingOutlookClientId'));
            return;
        }

        setSavingOutlookCredentials(true);
        try {
            const success = await actions.updateSettings({
                microsoft_client_id: outlookClientId,
                microsoft_tenant_id: outlookTenantId || 'common',
            });

            if (success) {
                const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
                const response = await api.startMicrosoftDeviceFlow(outlookClientId, outlookTenantId || 'common', token);
                if (response.data?.deviceCode) {
                    setOutlookDeviceCode(response.data.deviceCode);
                    setOutlookModalStep('device-code');
                    setIsOutlookConnecting(true);
                    pollOutlookLogin(response.data.deviceCode.deviceCode, outlookClientId, outlookTenantId || 'common');
                } else {
                    toast.error(t('config.toast.deviceFlowFailed'));
                }
            } else {
                toast.error(t('config.toast.saveCredsFailed'));
            }
        } catch (error) {
            toast.error(t('config.toast.saveCredsFailed'));
        } finally {
            setSavingOutlookCredentials(false);
        }
    };

    const pollOutlookLogin = async (deviceCode: string, clientId: string, tenantId: string) => {
        const pollInterval = setInterval(async () => {
            try {
                const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
                const response = await api.pollMicrosoftDeviceCode(deviceCode, clientId, tenantId, token);
                if (response.data?.success) {
                    clearInterval(pollInterval);
                    setOutlookDeviceCode(null);
                    setIsOutlookConnecting(false);
                    setShowOutlookModal(false);
                    toast.success(t('config.toast.outlookConnected'));
                    actions.fetchAccounts();
                }
            } catch (e) { }
        }, 5000);

        setTimeout(() => clearInterval(pollInterval), 15 * 60 * 1000);
    };

    const handleDisconnect = async (accountId: string) => {
        if (!confirm(t('config.toast.disconnectConfirm'))) return;
        const success = await actions.disconnectAccount(accountId);
        if (success) {
            toast.success(t('config.toast.accountDisconnected'));
        }
    };

    const getProviderIcon = (provider: string) => {
        if (provider === 'gmail') {
            return (
                <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400 font-bold">
                    G
                </div>
            );
        }
        if (provider === 'imap') {
            return (
                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400">
                    <Mail className="w-5 h-5" />
                </div>
            );
        }
        return (
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold">
                O
            </div>
        );
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Modals from original config */}
            <Dialog open={showGmailModal} onOpenChange={setShowGmailModal}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400 font-bold text-sm">G</div>
                            {t('config.gmail.connect')}
                        </DialogTitle>
                        <DialogDescription>
                            {gmailModalStep === 'credentials' ? t('config.gmail.credentialsDesc') : t('config.gmail.authCodeDesc')}
                        </DialogDescription>
                    </DialogHeader>

                    {gmailModalStep === 'credentials' ? (
                        <>
                            <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">{t('config.gmail.pasteJson')}</label>
                                    <textarea
                                        className="w-full h-24 p-3 text-xs font-mono border rounded-lg bg-secondary/10 resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                                        placeholder='{"installed":{"client_id":"...","client_secret":"..."}}'
                                        value={credentialsJson}
                                        onChange={(e) => handleCredentialsJsonChange(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-3">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">{t('config.byok.clientId')}</label>
                                        <Input
                                            placeholder={t('config.gmail.clientIdPlaceholder')}
                                            value={gmailClientId}
                                            onChange={(e) => setGmailClientId(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">{t('config.byok.clientSecret')}</label>
                                        <Input
                                            type="password"
                                            placeholder={t('config.gmail.clientSecretPlaceholder')}
                                            value={gmailClientSecret}
                                            onChange={(e) => setGmailClientSecret(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setShowGmailModal(false)}>{t('common.cancel')}</Button>
                                <Button onClick={handleSaveAndConnect} disabled={savingCredentials || !gmailClientId || !gmailClientSecret}>
                                    {savingCredentials ? <LoadingSpinner size="sm" className="mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                                    {t('common.save')} & Connect
                                </Button>
                            </DialogFooter>
                        </>
                    ) : (
                        <>
                            <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">{t('config.gmail.authCode')}</label>
                                    <Input
                                        placeholder={t('config.gmail.authCodePlaceholder')}
                                        value={gmailAuthCode}
                                        onChange={(e) => setGmailAuthCode(e.target.value)}
                                        className="font-mono"
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setGmailModalStep('credentials')}>{t('setup.back')}</Button>
                                <Button onClick={handleSubmitAuthCode} disabled={connectingGmail || !gmailAuthCode.trim()}>
                                    {connectingGmail ? <LoadingSpinner size="sm" className="mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                                    Connect
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={showOutlookModal} onOpenChange={setShowOutlookModal}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm">O</div>
                            {t('config.outlook.connect')}
                        </DialogTitle>
                    </DialogHeader>

                    {outlookModalStep === 'credentials' ? (
                        <>
                            <div className="space-y-4 py-4">
                                <div className="space-y-3">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">{t('config.outlook.clientId')}</label>
                                        <Input
                                            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                                            value={outlookClientId}
                                            onChange={(e) => setOutlookClientId(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">{t('config.outlook.tenantIdOptional')}</label>
                                        <Input
                                            placeholder={t('config.outlook.tenantPlaceholder')}
                                            value={outlookTenantId}
                                            onChange={(e) => setOutlookTenantId(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setShowOutlookModal(false)}>{t('common.cancel')}</Button>
                                <Button onClick={handleSaveOutlookAndConnect} disabled={savingOutlookCredentials || !outlookClientId}>
                                    {savingOutlookCredentials ? <LoadingSpinner size="sm" className="mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                                    Save & Connect
                                </Button>
                            </DialogFooter>
                        </>
                    ) : (
                        <>
                            {outlookDeviceCode && (
                                <div className="space-y-4 py-4">
                                    <p className="text-sm mb-4">{outlookDeviceCode.message}</p>
                                    <div className="bg-secondary/10 p-4 rounded-lg flex items-center justify-center">
                                        <code className="text-2xl font-mono font-bold tracking-wider">{outlookDeviceCode.userCode}</code>
                                    </div>
                                    <Button className="w-full" onClick={() => window.open(outlookDeviceCode.verificationUri, '_blank')}>Open Login Page</Button>
                                    <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                                        <LoadingSpinner size="sm" /> Waiting for authentication...
                                    </div>
                                </div>
                            )}
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setShowOutlookModal(false)}>{t('common.cancel')}</Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            <ImapConnectModal open={showImapModal} onOpenChange={setShowImapModal} />

            {/* Content */}
            <div ref={credentialsRef}>
                <Card>
                    <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setByokExpanded(!byokExpanded)}>
                        <CardTitle className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="w-5 h-5 text-orange-500" />
                                {t('config.byok.title')}
                            </div>
                            {byokExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                        </CardTitle>
                        <CardDescription>{t('config.byok.desc')}</CardDescription>
                    </CardHeader>
                    {byokExpanded && (
                        <CardContent className="space-y-6 animate-in slide-in-from-top-2">
                            <div className="space-y-4 border-b pb-4">
                                <h4 className="font-medium flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500" /> Google</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <Input type="password" placeholder="Client ID" value={localSettings.google_client_id || ''} onChange={(e) => setLocalSettings((s: any) => ({ ...s, google_client_id: e.target.value }))} />
                                    <Input type="password" placeholder="Client Secret" value={localSettings.google_client_secret || ''} onChange={(e) => setLocalSettings((s: any) => ({ ...s, google_client_secret: e.target.value }))} />
                                </div>
                            </div>
                            <div className="space-y-4">
                                <h4 className="font-medium flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500" /> Microsoft</h4>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <Input type="password" placeholder="Client ID" value={localSettings.microsoft_client_id || ''} onChange={(e) => setLocalSettings((s: any) => ({ ...s, microsoft_client_id: e.target.value }))} />
                                    <Input type="password" placeholder="Client Secret" value={localSettings.microsoft_client_secret || ''} onChange={(e) => setLocalSettings((s: any) => ({ ...s, microsoft_client_secret: e.target.value }))} />
                                    <Input placeholder="Tenant ID" value={localSettings.microsoft_tenant_id || ''} onChange={(e) => setLocalSettings((s: any) => ({ ...s, microsoft_tenant_id: e.target.value }))} />
                                </div>
                            </div>
                            <div className="flex justify-end mt-4">
                                <Button onClick={handleSaveSettings} disabled={savingSettings} variant="secondary">
                                    {savingSettings ? <LoadingSpinner size="sm" className="mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                                    Save API Credentials
                                </Button>
                            </div>
                        </CardContent>
                    )}
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Database className="w-5 h-5 text-primary" /> {t('config.accounts.title')}</CardTitle>
                    <CardDescription>{t('config.accounts.desc')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold">{t('config.accounts.addNew')}</h3>
                            <div className="grid grid-cols-1 gap-3">
                                <Button variant="outline" className="h-auto py-4 border-dashed justify-start" onClick={handleConnectGmail}>
                                    <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mr-3 text-red-600 font-bold">G</div>
                                    <div className="text-left font-medium">Connect Gmail</div>
                                </Button>
                                <Button variant="outline" className="h-auto py-4 border-dashed justify-start" onClick={handleConnectOutlook}>
                                    <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mr-3 text-blue-600 font-bold">O</div>
                                    <div className="text-left font-medium">Connect Outlook</div>
                                </Button>
                                <Button variant="outline" className="h-auto py-4 border-dashed justify-start" onClick={() => setShowImapModal(true)}>
                                    <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mr-3 text-slate-600"><Mail /></div>
                                    <div className="text-left font-medium">Connect IMAP</div>
                                </Button>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold">{t('config.accounts.yourAccounts')}</h3>
                            {state.accounts.length === 0 ? (
                                <div className="py-8 text-center text-muted-foreground border-2 border-dashed rounded-lg">No accounts connected</div>
                            ) : (
                                <div className="space-y-3">
                                    {state.accounts.map((acc: EmailAccount) => (
                                        <div key={acc.id} className="flex items-center justify-between p-3 border rounded-lg bg-card">
                                            <div className="flex items-center gap-3">
                                                {getProviderIcon(acc.provider)}
                                                <div>
                                                    <div className="font-medium text-sm">{acc.email_address}</div>
                                                    <div className="text-[10px] text-muted-foreground uppercase">{acc.provider}</div>
                                                </div>
                                            </div>
                                            <Button variant="ghost" size="sm" onClick={() => handleDisconnect(acc.id)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
