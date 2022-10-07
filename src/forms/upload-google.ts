import { head } from "lodash";
import moment from "moment";
import { MattermostClient } from "../clients";
import {
   getGoogleDocsClient,
   getGoogleDriveClient,
   getGoogleSheetsClient,
   getGoogleSlidesClient
} from "../clients/google-client";
import {
   AppExpandLevels,
   AppFieldTypes,
   ExceptionType,
   FilesToUpload,
   GoogleDriveIcon,
   Routes,
} from "../constant";
import {
   AppCallRequest,
   AppField,
   AppForm,
   AppSelectOption,
   MattermostOptions,
   PostCreate,
   Schema$File,
   Schema$User,
} from "../types";
import { SelectedUploadFilesForm } from "../types/forms";
import { throwException, tryPromise } from "../utils/utils";

export async function uploadFileConfirmationCall(call: AppCallRequest): Promise<AppForm> {
   const mattermostUrl: string | undefined = call.context.mattermost_site_url;
   const botAccessToken: string | undefined = call.context.acting_user_access_token;
   const postId: string = call.context.post?.id as string;

   const mattermostOpts: MattermostOptions = {
      mattermostUrl: <string>mattermostUrl,
      accessToken: <string>botAccessToken
   };
   const mmClient: MattermostClient = new MattermostClient(mattermostOpts);

   const Post = await mmClient.getPost(postId);
   const fileIds = Post.file_ids;
   if (!fileIds || !fileIds.length) {
      throwException(ExceptionType.MARKDOWN, `Selected post doesn't have any files to be uploaded`);
   }
   const fileMetadata = Post.metadata.files;

   const options: AppSelectOption[] = fileMetadata.map((file) => {
      return {
         label: file.name,
         value: file.id,
      };
   });

   const fields: AppField[] = [
      {
         type: AppFieldTypes.STATIC_SELECT,
         name: FilesToUpload.FILES,
         value: options,
         modal_label: `Select the files you'd like to upload to Google Drive`,
         options: options,
         multiselect: true
      }
   ];

   return {
      title: 'Upload to Google Drive',
      icon: GoogleDriveIcon,
      fields: fields,
      submit: {
         path: Routes.App.CallPathSaveFileSubmit,
         expand: {
            acting_user: AppExpandLevels.EXPAND_SUMMARY,
            acting_user_access_token: AppExpandLevels.EXPAND_ALL,
            oauth2_app: AppExpandLevels.EXPAND_SUMMARY,
            oauth2_user: AppExpandLevels.EXPAND_SUMMARY,
            post: AppExpandLevels.EXPAND_SUMMARY,
         }
      }
   } as AppForm;
}

export async function uploadFileConfirmationSubmit(call: AppCallRequest): Promise<void> {
   const mattermostUrl: string = call.context.mattermost_site_url as string;
   const botAccessToken: string = call.context.bot_access_token as string;
   const postId: string = call.context.post?.id as string;
   const channelId: string = call.context.post?.channel_id as string;
   const actingUserID = call.context.acting_user?.id as string;
   const values = call.values as SelectedUploadFilesForm;
   const saveFiles = values.upload_file_google_drive.map(val => val.value);

   const mattermostOpts: MattermostOptions = {
      mattermostUrl: mattermostUrl,
      accessToken: botAccessToken
   };
   const mmClient: MattermostClient = new MattermostClient(mattermostOpts);

   const Post = await mmClient.getPost(postId);
   const fileIds = Post.file_ids;
   const filesMetadata = Post.metadata?.files;
   const responseArray: Schema$File[] = [];

   const drive = await getGoogleDriveClient(call);
   for (let index = 0; index < fileIds.length; index++) {
      const metadata = filesMetadata[index];
      
      if (!saveFiles.includes(metadata.id)) 
         continue;

      const file = await mmClient.getFileUploaded(metadata.id);
      
      const requestBody = {
         name: metadata.name,
      };

      const media = {
         mimeType: metadata.mime_type,
         body: file
      };

      const fileUploaded = await tryPromise<Schema$File>(drive.files.create({
         requestBody: requestBody,
         media: media,
         fields: 'id,name,webViewLink,iconLink,owners,createdTime',
      }), ExceptionType.TEXT_ERROR, 'Google failed: ');
      
      responseArray.push(fileUploaded);
   }

   const attachments = responseArray.map((fileUp) => {
      const owner = head(fileUp.owners) as Schema$User;
      return {
         author_name: `${owner.displayName}`,
         author_icon: `${owner?.photoLink}`,
         title: `${fileUp.name}`,
         title_link: `${fileUp.webViewLink}`,
         footer: `Google Drive for Mattermost | ${moment(fileUp?.createdTime).format('MMM Do, YYYY')}`,
         footer_icon: `${fileUp.iconLink}`
      }
   })
   
   const post: PostCreate = {
      message: `File${attachments.length > 1 ? 's' : ''} uploaded to Google Drive!`,
      user_id: <string>actingUserID,
      channel_id: channelId,
      props: {
         attachments: attachments
      },
      root_id: postId
   };
   await mmClient.createPost(post);
}