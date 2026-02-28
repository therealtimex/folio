import { useState, useEffect } from 'react';
import { Cloud, CheckCircle2, ChevronRight, HardDrive } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { useLanguage } from '../../context/LanguageContext';
import { useApp } from '../../context/AppContext';
import { toast } from '../Toast';
import { api } from '../../lib/api';

export function StorageTab() {
    const { t } = useLanguage();
    const { supabase } = useApp();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [integrations, setIntegrations] = useState<any[]>([]);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [loading, setLoading] = useState(true);

    // Google Drive Modal State
    const [showDriveModal, setShowDriveModal] = useState(false);
    const [driveModalStep, setDriveModalStep] = useState<'credentials' | 'auth_code'>('credentials');
    const [driveClientId, setDriveClientId] = useState('');
    const [driveClientSecret, setDriveClientSecret] = useState('');
    const [driveAuthCode, setDriveAuthCode] = useState('');
    const [credentialsJson, setCredentialsJson] = useState('');
    const [isDriveConnecting, setIsDriveConnecting] = useState(false);

    useEffect(() => {
        fetchIntegrations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchIntegrations = async () => {
        try {
            const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
            const response = await api.getAccounts(token);
            if (response.data && response.data.accounts) {
                setIntegrations(response.data.accounts);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleCredentialsJsonChange = (value: string) => {
        setCredentialsJson(value);
        try {
            const parsed = JSON.parse(value);
            const webOrInstalled = parsed.web || parsed.installed;
            if (webOrInstalled?.client_id && webOrInstalled?.client_secret) {
                setDriveClientId(webOrInstalled.client_id);
                setDriveClientSecret(webOrInstalled.client_secret);
            }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
            // Invalid JSON, ignore
        }
    };

    const handleDriveSetup = async () => {
        if (!driveClientId || !driveClientSecret) {
            toast.error(t('config.gmail.error.missingCreds') || 'Please provide Client ID and Secret');
            return;
        }

        try {
            setIsDriveConnecting(true);
            const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
            const response = await api.getGoogleDriveAuthUrl(driveClientId.trim(), token);
            if (response.data?.authUrl) {
                window.open(response.data.authUrl, '_blank', 'width=600,height=700');
                setDriveModalStep('auth_code');
            } else {
                toast.error(t('config.gmail.error.authUrl') || 'Failed to generate auth URL');
            }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error) {
            toast.error(t('config.gmail.error.authUrl') || 'Failed to generate auth URL');
        } finally {
            setIsDriveConnecting(false);
        }
    };

    const handleDriveConnect = async () => {
        if (!driveAuthCode) {
            toast.error(t('config.gmail.error.missingCode') || 'Please provide Auth Code');
            return;
        }

        try {
            setIsDriveConnecting(true);
            const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
            const response = await api.connectGoogleDrive(
                driveAuthCode.trim(),
                driveClientId.trim(),
                driveClientSecret.trim(),
                token
            );

            if (response.data?.success) {
                toast.success('Successfully connected to Google Drive');
                setShowDriveModal(false);
                setDriveAuthCode('');
                fetchIntegrations();
            } else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                toast.error((response.error as any)?.message || 'Failed to connect');
            }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error) {
            toast.error('An error occurred while connecting');
        } finally {
            setIsDriveConnecting(false);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Google Drive Connection Modal */}
            <Dialog open={showDriveModal} onOpenChange={setShowDriveModal}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm">G</div>
                            Connect Google Drive
                        </DialogTitle>
                        <DialogDescription>
                            {driveModalStep === 'credentials' ? 'Provide your Google Cloud project credentials.' : 'Paste the authorization code.'}
                        </DialogDescription>
                    </DialogHeader>

                    {driveModalStep === 'credentials' ? (
                        <>
                            <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Paste credentials JSON</label>
                                    <textarea
                                        className="w-full h-24 p-3 text-xs font-mono border rounded-lg bg-secondary/10 resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                                        placeholder='{"installed":{"client_id":"...","client_secret":"..."}}'
                                        value={credentialsJson}
                                        onChange={(e) => handleCredentialsJsonChange(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-3">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Client ID</label>
                                        <Input
                                            placeholder="Enter Client ID"
                                            value={driveClientId}
                                            onChange={(e) => setDriveClientId(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Client Secret</label>
                                        <Input
                                            type="password"
                                            placeholder="Enter Client Secret"
                                            value={driveClientSecret}
                                            onChange={(e) => setDriveClientSecret(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="flex justify-end gap-3 pt-4 border-t">
                                <Button variant="ghost" onClick={() => setShowDriveModal(false)}>Cancel</Button>
                                <Button onClick={handleDriveSetup} disabled={isDriveConnecting || !driveClientId || !driveClientSecret}>
                                    {isDriveConnecting ? 'Generating...' : 'Next'} <ChevronRight className="w-4 h-4 ml-1" />
                                </Button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Authorization Code</label>
                                    <Input
                                        placeholder="Paste the code from Google here"
                                        value={driveAuthCode}
                                        onChange={(e) => setDriveAuthCode(e.target.value)}
                                        autoFocus
                                    />
                                    <p className="text-xs text-muted-foreground mt-2">
                                        A new window was opened for you to authorize the app. Once you approve, paste the code here.
                                    </p>
                                </div>
                            </div>
                            <div className="flex justify-between pt-4 border-t">
                                <Button variant="ghost" onClick={() => setDriveModalStep('credentials')}>Back</Button>
                                <div className="flex gap-2">
                                    <Button variant="ghost" onClick={() => setShowDriveModal(false)}>Cancel</Button>
                                    <Button onClick={handleDriveConnect} disabled={isDriveConnecting || !driveAuthCode}>
                                        {isDriveConnecting ? 'Connecting...' : 'Connect Drive'}
                                    </Button>
                                </div>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Cloud className="w-5 h-5 text-sky-500" />
                        Cloud Storage
                    </CardTitle>
                    <CardDescription>
                        Connect cloud drives like Google Drive or Dropbox to allow Folio to read and write documents directly to your cloud.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <Card className="flex flex-col border-dashed hover:border-solid hover:border-blue-300 transition-colors">
                            <CardHeader className="pb-3 text-center">
                                <div className="w-12 h-12 mx-auto rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-2">
                                    <HardDrive className="w-6 h-6" />
                                </div>
                                <CardTitle className="text-base">Google Drive</CardTitle>
                                <CardDescription className="text-xs">Sync files to and from Google Drive</CardDescription>
                            </CardHeader>
                            <CardContent className="flex-1 flex flex-col justify-end pt-0">
                                {integrations.some(i => i.provider === 'google_drive' && i.is_connected) ? (
                                    <Button className="w-full gap-2 text-xs" variant="secondary" disabled>
                                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                                        Connected
                                    </Button>
                                ) : (
                                    <Button className="w-full gap-2 text-xs" variant="outline" onClick={() => {
                                        setDriveModalStep('credentials');
                                        setShowDriveModal(true);
                                    }}>
                                        Connect Google Drive
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                        <Card className="flex flex-col border-dashed opacity-50 cursor-not-allowed">
                            <CardHeader className="pb-3 text-center">
                                <div className="w-12 h-12 mx-auto rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 mb-2">
                                    <Cloud className="w-6 h-6" />
                                </div>
                                <CardTitle className="text-base">Dropbox</CardTitle>
                                <CardDescription className="text-xs">Coming soon</CardDescription>
                            </CardHeader>
                            <CardContent className="flex-1 flex flex-col justify-end pt-0">
                                <Button className="w-full gap-2 text-xs" variant="outline" disabled>
                                    Coming Soon
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                </CardContent>
            </Card>
        </div >
    );
}
