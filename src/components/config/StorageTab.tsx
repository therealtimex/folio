import { Cloud } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../ui/card';
import { Button } from '../ui/button';

export function StorageTab() {
    return (
        <div className="space-y-6 animate-in fade-in duration-500">
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
                    <div className="py-12 text-center text-muted-foreground border-2 border-dashed rounded-xl">
                        <Cloud className="w-8 h-8 mx-auto mb-3 opacity-30" />
                        <p className="text-sm font-medium">Coming Soon</p>
                        <p className="text-xs mt-1">Cloud drive integrations are currently in development.</p>
                        <div className="mt-6 flex justify-center gap-3">
                            <Button variant="outline" disabled className="gap-2">
                                <div className="w-4 h-4 rounded-full bg-red-100 flex items-center justify-center mr-1 text-red-600 font-bold text-[8px]">G</div>
                                Google Drive
                            </Button>
                            <Button variant="outline" disabled className="gap-2">
                                <div className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center mr-1 text-blue-600 font-bold text-[8px]">D</div>
                                Dropbox
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
