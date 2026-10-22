#import <Cocoa/Cocoa.h>
#import <SafariServices/SafariServices.h>
@interface ArxivPDFReaderApp : NSObject <NSApplicationDelegate>
@property(strong) NSWindow *window;
@end
@implementation ArxivPDFReaderApp
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
 self.window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,580,340) styleMask:(NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable) backing:NSBackingStoreBuffered defer:NO];
 self.window.title=@"ArxivPDFReader";
 NSTextField *heading=[NSTextField labelWithString:@"ArxivPDFReader for Safari"];
 heading.font=[NSFont systemFontOfSize:28 weight:NSFontWeightSemibold];heading.frame=NSMakeRect(35,260,500,40);[self.window.contentView addSubview:heading];
 NSTextField *body=[NSTextField wrappingLabelWithString:@"Read research papers with section headings and citation previews. AI summaries are optional and off by default.\n\nThis is a local development build. In Safari Settings → Developer, enable Allow unsigned extensions, then enable ArxivPDFReader under Extensions. Safari resets unsigned-extension permission when it quits.\n\nOpen a PDF in Safari, allow ArxivPDFReader access to arXiv, then reload. To enhance an already-open PDF, choose Enhance this PDF from the toolbar. You can also open downloaded PDFs."];
 body.font=[NSFont systemFontOfSize:14];body.frame=NSMakeRect(35,85,510,165);[self.window.contentView addSubview:body];
 NSButton *button=[NSButton buttonWithTitle:@"Open Safari Extension Settings" target:self action:@selector(openSettings:)];button.frame=NSMakeRect(35,30,300,35);[self.window.contentView addSubview:button];
 [self.window center];[self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];
}
- (void)openSettings:(id)sender { [SFSafariApplication showPreferencesForExtensionWithIdentifier:@"dev.papertrail.reader.Extension" completionHandler:^(NSError *error){if(error)dispatch_async(dispatch_get_main_queue(),^{NSAlert *alert=[[NSAlert alloc]init];alert.messageText=@"Enable the development extension in Safari";alert.informativeText=@"Open Safari Settings → Advanced → Show features for web developers, then Developer → Allow unsigned extensions. Enable ArxivPDFReader under Extensions.";[alert runModal];});}]; }
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender{return YES;}
@end
int main(int argc,const char *argv[]){@autoreleasepool{NSApplication *app=[NSApplication sharedApplication];ArxivPDFReaderApp *delegate=[ArxivPDFReaderApp new];app.delegate=delegate;[app setActivationPolicy:NSApplicationActivationPolicyRegular];[app run];}}
