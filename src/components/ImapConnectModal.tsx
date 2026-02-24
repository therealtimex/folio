import { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { LoadingSpinner } from './LoadingSpinner';
import { Mail, Check, AlertCircle, Server } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from './Toast';
import { useApp } from '../context/AppContext';

interface ImapConnectModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function ImapConnectModal({ open, onOpenChange }: ImapConnectModalProps) {
    const { t } = useLanguage();
    const { actions } = useApp();
    const [isConnecting, setIsConnecting] = useState(false);

    // Form state
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    // Server settings
    const [imapHost, setImapHost] = useState('');
    const [imapPort, setImapPort] = useState(993);
    const [smtpHost, setSmtpHost] = useState('');
    const [smtpPort, setSmtpPort] = useState(465);
    const [imapSecure, setImapSecure] = useState(true);
    const [smtpSecure, setSmtpSecure] = useState(true);

    const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setEmail(val);

        if (val.includes('@')) {
            const domain = val.split('@')[1].toLowerCase();
            if (domain.includes('gmail.com')) {
                setImapHost('imap.gmail.com'); setSmtpHost('smtp.gmail.com');
                setImapPort(993); setImapSecure(true);
                setSmtpPort(465); setSmtpSecure(true);
            } else if (domain.includes('outlook.com') || domain.includes('hotmail.com')) {
                setImapHost('outlook.office365.com'); setSmtpHost('smtp.office365.com');
                setImapPort(993); setImapSecure(true);
                setSmtpPort(587); setSmtpSecure(false);
            } else if (domain.includes('yahoo.com')) {
                setImapHost('imap.mail.yahoo.com'); setSmtpHost('smtp.mail.yahoo.com');
                setImapPort(993); setImapSecure(true);
                setSmtpPort(465); setSmtpSecure(true);
            } else if (domain.includes('icloud.com')) {
                setImapHost('imap.mail.me.com'); setSmtpHost('smtp.mail.me.com');
                setImapPort(993); setImapSecure(true);
                setSmtpPort(587); setSmtpSecure(false);
            } else if (domain.includes('fastmail.com')) {
                setImapHost('imap.fastmail.com'); setSmtpHost('smtp.fastmail.com');
                setImapPort(993); setImapSecure(true);
                setSmtpPort(465); setSmtpSecure(true);
            }
        }
    };

    const handleConnect = async () => {
        if (!email || !password || !imapHost || !smtpHost) {
            toast.error(t('config.imap.missingFields'));
            return;
        }

        setIsConnecting(true);
        try {
            const response = await api.connectImap({
                email: email,
                password,
                imapHost: imapHost,
                imapPort: Number(imapPort),
                smtpHost: smtpHost,
                smtpPort: Number(smtpPort),
                imapSecure,
                smtpSecure
            });

            if (response.data?.success) {
                toast.success(t('config.imap.connected'));
                onOpenChange(false);
                actions.fetchAccounts();
                setEmail('');
                setPassword('');
                setImapHost(''); setSmtpHost('');
                setImapPort(993); setSmtpPort(465);
                setImapSecure(true); setSmtpSecure(true);
            } else {
                toast.error(t('config.imap.connectFailed'));
            }
        } catch (error) {
            console.error('IMAP Connect Error:', error);
            toast.error(t('config.imap.connectFailed'));
        } finally {
            setIsConnecting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400 font-bold text-sm">
                            <Mail className="w-4 h-4" />
                        </div>
                        {t('config.imap.connect')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('config.imap.desc')}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex gap-3">
                        <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                        <div className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                            <p className="font-medium">{t('config.imap.appPasswordTitle')}</p>
                            <p>{t('config.imap.appPasswordDesc')}</p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">{t('config.imap.emailLabel')}</label>
                            <Input
                                placeholder="you@example.com"
                                value={email}
                                onChange={handleEmailChange}
                                type="email"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">{t('config.imap.passwordLabel')}</label>
                            <Input
                                placeholder="xxxx-xxxx-xxxx-xxxx"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                type="password"
                            />
                        </div>

                        <div className="pt-2">
                            <div className="text-sm font-medium mb-2 flex items-center gap-2">
                                <Server className="w-4 h-4" />
                                {t('config.imap.serverSettings')}
                            </div>
                            <div className="grid grid-cols-2 gap-4 p-4 border rounded-lg bg-secondary/10">
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-muted-foreground">IMAP Host</label>
                                    <Input
                                        className="h-8 text-xs font-mono"
                                        placeholder="imap.example.com"
                                        value={imapHost}
                                        onChange={(e) => setImapHost(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-muted-foreground">Port</label>
                                    <Input
                                        className="h-8 text-xs font-mono"
                                        placeholder="993"
                                        type="number"
                                        value={imapPort}
                                        onChange={(e) => { const p = parseInt(e.target.value) || 993; setImapPort(p); setImapSecure(p === 993); }}
                                    />
                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                        <input type="checkbox" checked={imapSecure} onChange={e => setImapSecure(e.target.checked)} className="accent-primary" />
                                        <span className="text-xs text-muted-foreground">Implicit TLS</span>
                                    </label>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-muted-foreground">SMTP Host</label>
                                    <Input
                                        className="h-8 text-xs font-mono"
                                        placeholder="smtp.example.com"
                                        value={smtpHost}
                                        onChange={(e) => setSmtpHost(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-muted-foreground">Port</label>
                                    <Input
                                        className="h-8 text-xs font-mono"
                                        placeholder="465"
                                        type="number"
                                        value={smtpPort}
                                        onChange={(e) => { const p = parseInt(e.target.value) || 465; setSmtpPort(p); setSmtpSecure(p === 465); }}
                                    />
                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                        <input type="checkbox" checked={smtpSecure} onChange={e => setSmtpSecure(e.target.checked)} className="accent-primary" />
                                        <span className="text-xs text-muted-foreground">Implicit TLS</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t('common.cancel')}
                    </Button>
                    <Button
                        onClick={handleConnect}
                        disabled={isConnecting || !email || !password || !imapHost || !smtpHost}
                    >
                        {isConnecting ? (
                            <LoadingSpinner size="sm" className="mr-2" />
                        ) : (
                            <Check className="w-4 h-4 mr-2" />
                        )}
                        {t('config.imap.connectBtn')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
