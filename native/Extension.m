#import <Foundation/Foundation.h>
#import <SafariServices/SafariServices.h>

// Deliberately narrow native transport: Pangram only, no filesystem access,
// arbitrary URLs, cookies, persistent keys, public reports, or redirects.
@interface SafariArxivReaderExtensionHandler : NSObject <NSExtensionRequestHandling, NSURLSessionTaskDelegate>
@end
@implementation SafariArxivReaderExtensionHandler
- (void)reply:(NSDictionary *)message context:(NSExtensionContext *)context {
 NSExtensionItem *item=[NSExtensionItem new];item.userInfo=@{SFExtensionMessageKey:message};
 [context completeRequestReturningItems:@[item] completionHandler:nil];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completionHandler { completionHandler(nil); }
- (void)beginRequestWithExtensionContext:(NSExtensionContext *)context {
 id value=((NSExtensionItem *)context.inputItems.firstObject).userInfo[SFExtensionMessageKey];
 if(![value isKindOfClass:NSDictionary.class]){[self reply:@{@"error":@"Invalid native request."} context:context];return;}
 NSDictionary *message=value;
 NSString *path=message[@"path"],*key=message[@"key"];id body=message[@"body"];
 NSRegularExpression *route=[NSRegularExpression regularExpressionWithPattern:@"^/(models|task(/[A-Za-z0-9_-]+)?)$" options:0 error:nil];
 BOOL valid=[message[@"type"] isEqual:@"papertrail-pangram"]&&[path isKindOfClass:NSString.class]&&[key isKindOfClass:NSString.class]&&key.length>0&&key.length<=4096&&[key rangeOfCharacterFromSet:NSCharacterSet.newlineCharacterSet].location==NSNotFound;
 if(valid)valid=[route numberOfMatchesInString:path options:0 range:NSMakeRange(0,path.length)]==1;
 if(body&&body!=NSNull.null){
  valid=valid&&[path isEqual:@"/task"]&&[body isKindOfClass:NSDictionary.class];
  if(valid)valid=[body[@"text"] isKindOfClass:NSString.class]&&[body[@"text"] length]>0&&[body[@"text"] length]<=500000&&[body[@"model"] isKindOfClass:NSString.class]&&[body[@"model"] length]>0;
 }else body=nil;
 if(!valid){[self reply:@{@"error":@"Invalid Pangram request."} context:context];return;}
 NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:[@"https://text.external-api.pangram.com" stringByAppendingString:path]]];
 request.timeoutInterval=30;request.HTTPMethod=body?@"POST":@"GET";
 [request setValue:key forHTTPHeaderField:@"x-api-key"];
 if(body){[request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];request.HTTPBody=[NSJSONSerialization dataWithJSONObject:@{@"text":body[@"text"],@"model":body[@"model"],@"public_dashboard_link":@NO} options:0 error:nil];}
 NSURLSessionConfiguration *config=NSURLSessionConfiguration.ephemeralSessionConfiguration;
 config.HTTPCookieStorage=nil;config.HTTPShouldSetCookies=NO;config.URLCache=nil;config.URLCredentialStorage=nil;config.timeoutIntervalForResource=40;
 NSURLSession *session=[NSURLSession sessionWithConfiguration:config delegate:self delegateQueue:nil];
 [[session dataTaskWithRequest:request completionHandler:^(NSData *data,NSURLResponse *response,NSError *error){
  NSInteger status=[response isKindOfClass:NSHTTPURLResponse.class]?((NSHTTPURLResponse *)response).statusCode:0;
  if(error){[self reply:@{@"error":@"Could not reach Pangram. Check your connection; if submitting, check your Pangram dashboard before retrying."} context:context];}
  else if(status<200||status>=300){
   NSDictionary *errors=@{@401:@"The Pangram API key was rejected.",@402:@"Your Pangram account needs API credits.",@403:@"This Pangram key cannot access the selected model or task.",@429:@"Pangram is busy or rate-limited. Try again shortly.",@422:@"Pangram could not analyze this text or model."};
   [self reply:@{@"error":errors[@(status)]?:[NSString stringWithFormat:@"Pangram returned %ld. Try again later.",(long)status]} context:context];
  }else if(data.length>10000000){[self reply:@{@"error":@"Pangram response is too large."} context:context];}
  else{
   id json=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
   if(![json isKindOfClass:NSDictionary.class]){[self reply:@{@"error":@"Pangram returned an invalid response."} context:context];}
   else{
    NSMutableDictionary *result=[NSMutableDictionary new];
    for(NSString *field in @[@"models",@"task_id",@"stage",@"fraction_ai",@"fraction_ai_assisted",@"fraction_human",@"prediction_short"]){if(json[field])result[field]=json[field];}
    [self reply:@{@"data":result} context:context];
   }
  }
  [session finishTasksAndInvalidate];
 }] resume];
}
@end
