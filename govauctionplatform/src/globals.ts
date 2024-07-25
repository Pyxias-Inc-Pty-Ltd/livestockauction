export type userType = "BIDDER" | "ADMIN" | "SELLER";
export type adminType = "SUPER";
export type transactionType = "REFUND" | "PURCHASE" | "RESERVATION";
export type itemStatus = "NOT_BEGUN" | "ACTIVE" | "ENDED" | "CANCELLED";
export type auctionStatus = "NOT_BEGUN" | "ACTIVE" | "ENDED" | "CANCELLED";
export type animalSpecies = "BOVINE" | "EQUINE" | "CAPRINE" | "OVINE" | "PORCINE";
export type paymentStatus = "PENDING" | "FAILED" | "COMPLETED";
export type paymentProvider = "CELLULANT" | "UNIPAY";
export type genderType = "MALE" | "FEMALE" | "MIXED";
export type participationType = "CITIZEN_ONLY" | "EVERYONE";

export type fauxObject = {[key: string]: any};

export const STATE_JWT_SECRET = process.env.STATE_JWT_SECRET as string;
export const ENVIRONMENT_PRODUCTION: string = "production";

export const LIST_LIMIT_NUMBER = 20;
export const SALT_ROUNDS = 12;
export const MAX_LIST_LIMIT_NUMBER = 100;
export const GENERIC_ERROR_MESSAGE = "Something went wrong, please try again later";
export const ESCAPE_HTTP_ORIGIN_SOCKET_IO = "http://localhost:3000"; // TODO: Update before production
export const TINGG_BILLING_SERVICE_ID = 3412;
export const LOCAL_NATIONALITY = 'BW';

export const FIREBASE_SERVICE_ACCOUNT_CREDENTIALS = JSON.stringify({
  "type": "service_account",
  "project_id": "bw-goverment-auction-platform",
  "private_key_id": "0dcde5690a2e668ead9549b44e79d50d0d6c684f",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCoXvzFU7Z78LU3\nn8/qEdwOb10eN1UxdhLvyFec+TeJo6omDG1UdTlSUjfuO8VJAKwxoRF05GoROatT\n+wIEEIhfRS64NYAweVdj6l2dIZTQ7Fe1MxTIXhvbRDAebDnhruZTM3PEH2QTJdUA\no/uL+LcRLx+6HWFgoxfhOURRLiqG4abtvj58RnCVcmWSAu5yW3S946jsvnnYrmax\njheU87nnw4EhJuoB4iGvzDBVTO1N4ZsVrg65k0O+zv3bvuwcR6zVUgqqFYc+Bdlb\nd6hni3OHBtcmlkESXQ5QVRhphaZEkXIG0GR+CvH1NvYDY0dqSUIq+PUdSXV7M7Ga\ns9Gq+TphAgMBAAECggEADjb+xjYcGPiohAq1BgD+ACX8yZlIUwWx8ZaLdxA/VRqB\nOfcgn9nJvh585Fsde91XrFT54VGLdurUgSGW+PrgWJLBsAGsUetcqm3V+3cjVkQt\n33lxjr0LQwbNvTPL6zbV8T5NzsgLreYqxoQRr66O3h+JYTAr0XnTgUtRbj0kkACH\nyKg1SlZwP+budFCieJzijgrva6DTSF1t+5dldM8peOTksLZnVQP364HByGwhbsv+\nxIeuT1W42MDWj7OjLP3ZKkdaXHNoFxZLoaq/qmXRNPM/hUegt4rY7nUm5rs5YM3K\nbhtWbwk0IwXVHoFxzgdYXrRjamjlV2J/KbuavXSvNQKBgQDpVyHxS5rUkNbpAZoB\nfXKYDgrCqWePoxyQeUBInlhDIkd+hHz2z0SgY98tqqEaOmxMR76rfDhdPBqJZVfj\nY5r2cL3AWTA6Shk5U0gCfZerHEKLdrTgygfSmAzngMMtiqd7+avPuiPbodb+UT6v\n6Q5dzbhlXSN6aLj6XVy/fQIXbwKBgQC4uLXYA8G+nE+u8Dn5QKI0Cz/2ehv5SKU0\n+bt2BulGAKTiSfqXwMhOSZTDpD50OvOAGgZj4v4UJ6oTjXsetz0++D4Edeu08Krw\nE7xJdsTujXJVYPygxaV8bzig4f+ty02EytoQm2OKK35QDUO3OP++SJTm+Y1mocdD\ng1qodGljLwKBgCsWoffy5CZ4kJb6arv3tF+LyETmD2+gyTeMjGhchSPwgo9EW+cf\noyaTCrVeGt3DCBiV7wmvqKDe5m+UvUQKMqVrcD7CuXsqD7pcPKHpG0bHsyoZw5D2\n/bbPySI+zsvsHL1x/14em1yFaDQSQKcvPC3qPTDKoDCMggwJjYT2ypoVAoGBAISY\nOhe0IqezRlN5pvOvHH+lL6W6Y0geiFAtjw2aymnwXmr81X+G54GiucFxrU77Xfyv\nMbUTpHRNQH1GioEy4SjJQqMrDiXUt68bS4WkVpoyOEbnFpBFL5PRtmFtuH1FOQDA\nJ6XSFLKCo+nMi7YCmTk6mn/t1D0+lW115WaUIW4LAoGBAMWWGcognXBs7fVn8hv4\nlfRIazP3bQQwXtNcKd359QLVKk4elu2zp2XzIWDUyEneaIGuP15ck9AVYNK/UjLQ\nH8axIgSyWkYzbEjWvEbsLaLiECfEqeIZsS/QuHeL0F0pnsUEMUx4FDE6kcIyUGlX\nt0gJgzRokDC+LeBddIxWpMoS\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-n9wlb@bw-goverment-auction-platform.iam.gserviceaccount.com",
  "client_id": "117201245138807169384",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-n9wlb@bw-goverment-auction-platform.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
});
export const EXPRESS_SESSION_SECRET = process.env.EXPRESS_SESSION_SECRET as string;
const MONGO_DB_PASS = process.env.MONGO_DB_PASS as string;
const MONGO_DB_USER = process.env.MONGO_DB_USER as string;
// export const UNIPAY_APP_AUTH_TOKEN = process.env.UNIPAY_APP_AUTH_TOKEN as string;
export const UNIPAY_APP_AUTH_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWJqZWN0IjoiNjY3YzVmOTMwM2YzZjEyODRhMWI0OGVhIiwic2NvcGUiOiJBUEkiLCJpYXQiOjE3MTk0MjY5NjN9.xi1tGljRdbpFzamQlD1G4TVYK1gWt6xyEAXrT4MVpko";

export const SERVICE_URLS: {[key: string]: string} = {
  mongoDBURI: `mongodb+srv://${MONGO_DB_USER}:${MONGO_DB_PASS}@cluster0.5odo36p.mongodb.net/bwgovauctionplatform?retryWrites=true&w=majority`,
  tinggCreatePaymentLinkURI: "https://paybylink-apis.pay.tingg.africa/paybylink-apis/public/bill/create",
  unipayInitiatePaymentApplication: "http://164.92.135.170:8888/api/applications/initiatePaymentApplicationByApp",
  clientURI: "https://auctiondev.xyz"
}

export const COUNTRY_PHONE_CODES = [{"country":"Afghanistan","code":"93","iso":"AF"},
{"country":"Albania","code":"355","iso":"AL"},
{"country":"Algeria","code":"213","iso":"DZ"},
{"country":"American Samoa","code":"1-684","iso":"AS"},
{"country":"Andorra","code":"376","iso":"AD"},
{"country":"Angola","code":"244","iso":"AO"},
{"country":"Anguilla","code":"1-264","iso":"AI"},
{"country":"Antarctica","code":"672","iso":"AQ"},
{"country":"Antigua and Barbuda","code":"1-268","iso":"AG"},
{"country":"Argentina","code":"54","iso":"AR"},
{"country":"Armenia","code":"374","iso":"AM"},
{"country":"Aruba","code":"297","iso":"AW"},
{"country":"Australia","code":"61","iso":"AU"},
{"country":"Austria","code":"43","iso":"AT"},
{"country":"Azerbaijan","code":"994","iso":"AZ"},
{"country":"Bahamas","code":"1-242","iso":"BS"},
{"country":"Bahrain","code":"973","iso":"BH"},
{"country":"Bangladesh","code":"880","iso":"BD"},
{"country":"Barbados","code":"1-246","iso":"BB"},
{"country":"Belarus","code":"375","iso":"BY"},
{"country":"Belgium","code":"32","iso":"BE"},
{"country":"Belize","code":"501","iso":"BZ"},
{"country":"Benin","code":"229","iso":"BJ"},
{"country":"Bermuda","code":"1-441","iso":"BM"},
{"country":"Bhutan","code":"975","iso":"BT"},
{"country":"Bolivia","code":"591","iso":"BO"},
{"country":"Bosnia and Herzegovina","code":"387","iso":"BA"},
{"country":"Botswana","code":"267","iso":"BW"},
{"country":"Brazil","code":"55","iso":"BR"},
{"country":"British Indian Ocean Territory","code":"246","iso":"IO"},
{"country":"British Virgin Islands","code":"1-284","iso":"VG"},
{"country":"Brunei","code":"673","iso":"BN"},
{"country":"Bulgaria","code":"359","iso":"BG"},
{"country":"Burkina Faso","code":"226","iso":"BF"},
{"country":"Burundi","code":"257","iso":"BI"},
{"country":"Cambodia","code":"855","iso":"KH"},
{"country":"Cameroon","code":"237","iso":"CM"},
{"country":"Canada","code":"1","iso":"CA"},
{"country":"Cape Verde","code":"238","iso":"CV"},
{"country":"Cayman Islands","code":"1-345","iso":"KY"},
{"country":"Central African Republic","code":"236","iso":"CF"},
{"country":"Chad","code":"235","iso":"TD"},
{"country":"Chile","code":"56","iso":"CL"},
{"country":"China","code":"86","iso":"CN"},
{"country":"Christmas Island","code":"61","iso":"CX"},
{"country":"Cocos Islands","code":"61","iso":"CC"},
{"country":"Colombia","code":"57","iso":"CO"},
{"country":"Comoros","code":"269","iso":"KM"},
{"country":"Cook Islands","code":"682","iso":"CK"},
{"country":"Costa Rica","code":"506","iso":"CR"},
{"country":"Croatia","code":"385","iso":"HR"},
{"country":"Cuba","code":"53","iso":"CU"},
{"country":"Curacao","code":"599","iso":"CW"},
{"country":"Cyprus","code":"357","iso":"CY"},
{"country":"Czech Republic","code":"420","iso":"CZ"},
{"country":"Democratic Republic of the Congo","code":"243","iso":"CD"},
{"country":"Denmark","code":"45","iso":"DK"},
{"country":"Djibouti","code":"253","iso":"DJ"},
{"country":"Dominica","code":"1-767","iso":"DM"},
{"country":"Dominican Republic","code":"1-809, 1-829, 1-849","iso":"DO"},
{"country":"East Timor","code":"670","iso":"TL"},
{"country":"Ecuador","code":"593","iso":"EC"},
{"country":"Egypt","code":"20","iso":"EG"},
{"country":"El Salvador","code":"503","iso":"SV"},
{"country":"Equatorial Guinea","code":"240","iso":"GQ"},
{"country":"Eritrea","code":"291","iso":"ER"},
{"country":"Estonia","code":"372","iso":"EE"},
{"country":"Ethiopia","code":"251","iso":"ET"},
{"country":"Falkland Islands","code":"500","iso":"FK"},
{"country":"Faroe Islands","code":"298","iso":"FO"},
{"country":"Fiji","code":"679","iso":"FJ"},
{"country":"Finland","code":"358","iso":"FI"},
{"country":"France","code":"33","iso":"FR"},
{"country":"French Polynesia","code":"689","iso":"PF"},
{"country":"Gabon","code":"241","iso":"GA"},
{"country":"Gambia","code":"220","iso":"GM"},
{"country":"Georgia","code":"995","iso":"GE"},
{"country":"Germany","code":"49","iso":"DE"},
{"country":"Ghana","code":"233","iso":"GH"},
{"country":"Gibraltar","code":"350","iso":"GI"},
{"country":"Greece","code":"30","iso":"GR"},
{"country":"Greenland","code":"299","iso":"GL"},
{"country":"Grenada","code":"1-473","iso":"GD"},
{"country":"Guam","code":"1-671","iso":"GU"},
{"country":"Guatemala","code":"502","iso":"GT"},
{"country":"Guernsey","code":"44-1481","iso":"GG"},
{"country":"Guinea","code":"224","iso":"GN"},
{"country":"Guinea-Bissau","code":"245","iso":"GW"},
{"country":"Guyana","code":"592","iso":"GY"},
{"country":"Haiti","code":"509","iso":"HT"},
{"country":"Honduras","code":"504","iso":"HN"},
{"country":"Hong Kong","code":"852","iso":"HK"},
{"country":"Hungary","code":"36","iso":"HU"},
{"country":"Iceland","code":"354","iso":"IS"},
{"country":"India","code":"91","iso":"IN"},
{"country":"Indonesia","code":"62","iso":"ID"},
{"country":"Iran","code":"98","iso":"IR"},
{"country":"Iraq","code":"964","iso":"IQ"},
{"country":"Ireland","code":"353","iso":"IE"},
{"country":"Isle of Man","code":"44-1624","iso":"IM"},
{"country":"Israel","code":"972","iso":"IL"},
{"country":"Italy","code":"39","iso":"IT"},
{"country":"Ivory Coast","code":"225","iso":"CI"},
{"country":"Jamaica","code":"1-876","iso":"JM"},
{"country":"Japan","code":"81","iso":"JP"},
{"country":"Jersey","code":"44-1534","iso":"JE"},
{"country":"Jordan","code":"962","iso":"JO"},
{"country":"Kazakhstan","code":"7","iso":"KZ"},
{"country":"Kenya","code":"254","iso":"KE"},
{"country":"Kiribati","code":"686","iso":"KI"},
{"country":"Kosovo","code":"383","iso":"XK"},
{"country":"Kuwait","code":"965","iso":"KW"},
{"country":"Kyrgyzstan","code":"996","iso":"KG"},
{"country":"Laos","code":"856","iso":"LA"},
{"country":"Latvia","code":"371","iso":"LV"},
{"country":"Lebanon","code":"961","iso":"LB"},
{"country":"Lesotho","code":"266","iso":"LS"},
{"country":"Liberia","code":"231","iso":"LR"},
{"country":"Libya","code":"218","iso":"LY"},
{"country":"Liechtenstein","code":"423","iso":"LI"},
{"country":"Lithuania","code":"370","iso":"LT"},
{"country":"Luxembourg","code":"352","iso":"LU"},
{"country":"Macao","code":"853","iso":"MO"},
{"country":"Macedonia","code":"389","iso":"MK"},
{"country":"Madagascar","code":"261","iso":"MG"},
{"country":"Malawi","code":"265","iso":"MW"},
{"country":"Malaysia","code":"60","iso":"MY"},
{"country":"Maldives","code":"960","iso":"MV"},
{"country":"Mali","code":"223","iso":"ML"},
{"country":"Malta","code":"356","iso":"MT"},
{"country":"Marshall Islands","code":"692","iso":"MH"},
{"country":"Mauritania","code":"222","iso":"MR"},
{"country":"Mauritius","code":"230","iso":"MU"},
{"country":"Mayotte","code":"262","iso":"YT"},
{"country":"Mexico","code":"52","iso":"MX"},
{"country":"Micronesia","code":"691","iso":"FM"},
{"country":"Moldova","code":"373","iso":"MD"},
{"country":"Monaco","code":"377","iso":"MC"},
{"country":"Mongolia","code":"976","iso":"MN"},
{"country":"Montenegro","code":"382","iso":"ME"},
{"country":"Montserrat","code":"1-664","iso":"MS"},
{"country":"Morocco","code":"212","iso":"MA"},
{"country":"Mozambique","code":"258","iso":"MZ"},
{"country":"Myanmar","code":"95","iso":"MM"},
{"country":"Namibia","code":"264","iso":"NA"},
{"country":"Nauru","code":"674","iso":"NR"},
{"country":"Nepal","code":"977","iso":"NP"},
{"country":"Netherlands","code":"31","iso":"NL"},
{"country":"Netherlands Antilles","code":"599","iso":"AN"},
{"country":"New Caledonia","code":"687","iso":"NC"},
{"country":"New Zealand","code":"64","iso":"NZ"},
{"country":"Nicaragua","code":"505","iso":"NI"},
{"country":"Niger","code":"227","iso":"NE"},
{"country":"Nigeria","code":"234","iso":"NG"},
{"country":"Niue","code":"683","iso":"NU"},
{"country":"North Korea","code":"850","iso":"KP"},
{"country":"Northern Mariana Islands","code":"1-670","iso":"MP"},
{"country":"Norway","code":"47","iso":"NO"},
{"country":"Oman","code":"968","iso":"OM"},
{"country":"Pakistan","code":"92","iso":"PK"},
{"country":"Palau","code":"680","iso":"PW"},
{"country":"Palestine","code":"970","iso":"PS"},
{"country":"Panama","code":"507","iso":"PA"},
{"country":"Papua New Guinea","code":"675","iso":"PG"},
{"country":"Paraguay","code":"595","iso":"PY"},
{"country":"Peru","code":"51","iso":"PE"},
{"country":"Philippines","code":"63","iso":"PH"},
{"country":"Pitcairn","code":"64","iso":"PN"},
{"country":"Poland","code":"48","iso":"PL"},
{"country":"Portugal","code":"351","iso":"PT"},
{"country":"Puerto Rico","code":"1-787, 1-939","iso":"PR"},
{"country":"Qatar","code":"974","iso":"QA"},
{"country":"Republic of the Congo","code":"242","iso":"CG"},
{"country":"Reunion","code":"262","iso":"RE"},
{"country":"Romania","code":"40","iso":"RO"},
{"country":"Russia","code":"7","iso":"RU"},
{"country":"Rwanda","code":"250","iso":"RW"},
{"country":"Saint Barthelemy","code":"590","iso":"BL"},
{"country":"Saint Helena","code":"290","iso":"SH"},
{"country":"Saint Kitts and Nevis","code":"1-869","iso":"KN"},
{"country":"Saint Lucia","code":"1-758","iso":"LC"},
{"country":"Saint Martin","code":"590","iso":"MF"},
{"country":"Saint Pierre and Miquelon","code":"508","iso":"PM"},
{"country":"Saint Vincent and the Grenadines","code":"1-784","iso":"VC"},
{"country":"Samoa","code":"685","iso":"WS"},
{"country":"San Marino","code":"378","iso":"SM"},
{"country":"Sao Tome and Principe","code":"239","iso":"ST"},
{"country":"Saudi Arabia","code":"966","iso":"SA"},
{"country":"Senegal","code":"221","iso":"SN"},
{"country":"Serbia","code":"381","iso":"RS"},
{"country":"Seychelles","code":"248","iso":"SC"},
{"country":"Sierra Leone","code":"232","iso":"SL"},
{"country":"Singapore","code":"65","iso":"SG"},
{"country":"Sint Maarten","code":"1-721","iso":"SX"},
{"country":"Slovakia","code":"421","iso":"SK"},
{"country":"Slovenia","code":"386","iso":"SI"},
{"country":"Solomon Islands","code":"677","iso":"SB"},
{"country":"Somalia","code":"252","iso":"SO"},
{"country":"South Africa","code":"27","iso":"ZA"},
{"country":"South Korea","code":"82","iso":"KR"},
{"country":"South Sudan","code":"211","iso":"SS"},
{"country":"Spain","code":"34","iso":"ES"},
{"country":"Sri Lanka","code":"94","iso":"LK"},
{"country":"Sudan","code":"249","iso":"SD"},
{"country":"Suriname","code":"597","iso":"SR"},
{"country":"Svalbard and Jan Mayen","code":"47","iso":"SJ"},
{"country":"Swaziland","code":"268","iso":"SZ"},
{"country":"Sweden","code":"46","iso":"SE"},
{"country":"Switzerland","code":"41","iso":"CH"},
{"country":"Syria","code":"963","iso":"SY"},
{"country":"Taiwan","code":"886","iso":"TW"},
{"country":"Tajikistan","code":"992","iso":"TJ"},
{"country":"Tanzania","code":"255","iso":"TZ"},
{"country":"Thailand","code":"66","iso":"TH"},
{"country":"Togo","code":"228","iso":"TG"},
{"country":"Tokelau","code":"690","iso":"TK"},
{"country":"Tonga","code":"676","iso":"TO"},
{"country":"Trinidad and Tobago","code":"1-868","iso":"TT"},
{"country":"Tunisia","code":"216","iso":"TN"},
{"country":"Turkey","code":"90","iso":"TR"},
{"country":"Turkmenistan","code":"993","iso":"TM"},
{"country":"Turks and Caicos Islands","code":"1-649","iso":"TC"},
{"country":"Tuvalu","code":"688","iso":"TV"},
{"country":"U.S. Virgin Islands","code":"1-340","iso":"VI"},
{"country":"Uganda","code":"256","iso":"UG"},
{"country":"Ukraine","code":"380","iso":"UA"},
{"country":"United Arab Emirates","code":"971","iso":"AE"},
{"country":"United Kingdom","code":"44","iso":"GB"},
{"country":"United States","code":"1","iso":"US"},
{"country":"Uruguay","code":"598","iso":"UY"},
{"country":"Uzbekistan","code":"998","iso":"UZ"},
{"country":"Vanuatu","code":"678","iso":"VU"},
{"country":"Vatican","code":"379","iso":"VA"},
{"country":"Venezuela","code":"58","iso":"VE"},
{"country":"Vietnam","code":"84","iso":"VN"},
{"country":"Wallis and Futuna","code":"681","iso":"WF"},
{"country":"Western Sahara","code":"212","iso":"EH"},
{"country":"Yemen","code":"967","iso":"YE"},
{"country":"Zambia","code":"260","iso":"ZM"},
{"country":"Zimbabwe","code":"263","iso":"ZW"}];

export enum EAuctionStatus {
  ALL = "ALL",
  FRONT_VIEW = "FRONT_VIEW",
  NOT_BEGUN = "NOT_BEGUN",
  ACTIVE = "ACTIVE",
  ENDED = "ENDED",
  CANCELLED = "CANCELLED"
}

export enum EItemStatus {
  NOT_BEGUN = "NOT_BEGUN",
  ACTIVE = "ACTIVE",
  ENDED = "ENDED",
  CANCELLED = "CANCELLED"
}

export enum EUserType {
  BIDDER = "BIDDER",
  SELLER = "SELLER",
  ADMIN = "ADMIN"
}

export enum EAdminType {
  SUPER = "SUPER"
}

export enum EAccessScope {
  API = "API"
}

export enum EPaymentStatus {
  PENDING = "PENDING",
  FAILED = "FAILED",
  COMPLETED = "COMPLETED"
}

export enum ETransactionType {
  REFUND = "REFUND",
  PURCHASE = "PURCHASE",
  RESERVATION = "RESERVATION"
}

export enum EModels {
  ADMIN = "Admin",
  BREED = "Breed",
  USER = "User",
  BIDDER = "Bidder",
  SELLER = "Seller",
  ITEM = "Item",
  AUCTION = "Auction",
  BID = "Bid",
  TRANSACTION = "Transaction",
  CATEGORY = "Category",
  MESSAGE = "Message",
  CHAT = "Chat",
  TOKEN = "Token",
  FORUM = "Forum",
  FORUM_COMMENT = "ForumComment",
  NOTIFICATION = "Notification",
  NOTIFICATION_OBJECT = "NotificationObject",
  NOTIFICATION_CHANGE = "NotificationChange",
  NOTIFICATION_TRIGGER= "NotificationTrigger"
}

export enum ESortOrderType {
  ASC = "ASC",
  DESC = "DESC",
  asc = "asc",
  desc = "desc"
}

export enum EItemSortType {
  RESERVE_PRICE = "RESERVE_PRICE",
  DATE = "DATE"
}

export enum EUniPayPaymentStatus {
  REJECTED = "REJECTED",
  CANCELLED = "CANCELLED",
  ACCEPTED = "ACCEPTED"
}

export enum EAuctionSortType {
  DATE = "DATE"
}

export enum EBidSortType {
  DATE = "DATE",
  AMOUNT = "AMOUNT"
}

export enum EMessageSortType {
  DATE = "DATE"
}

export enum EUserSortType {
  DATE = "DATE"
}

export enum ETransactionSortType {
  DATE = "DATE",
  AMOUNT = "AMOUNT"
}

export enum ESocketEventCode {
  JOIN_BIDDING_ROOM = "e:1",
  CREATE_BID = "e:2",
  UPDATE_BID_AMOUNT = "e:3",
  JOIN_BIDDING_ROOM_CHAT = "e:4",
  CREATE_CHAT_MESSAGE = "e:5",
  BROADCAST_CHAT_MESSAGE = "e:6",
  POLL_PAID_TRANSACTION = "e:7",
  DELETE_BID = "e:8"
}

export enum EParticipationType {
  CITIZEN_ONLY = "CITIZEN_ONLY",
  EVERYONE = "EVERYONE"
}

export enum EPaymentProvider {
  CELLULANT = "CELLULANT",
  UNIPAY = "UNIPAY"
}

export enum EGenderType {
  MALE = "MALE",
  FEMALE = "FEMALE",
  MIXED = "MIXED"
}

export enum EBreedSortType {
  NAME = "NAME"
}

export enum EAnimalSpecies {
  BOVINE = "BOVINE",
  EQUINE = "EQUINE",
  CAPRINE = "CAPRINE",
  OVINE = "OVINE",
  PORCINE = "PORCINE"
}

export enum EPushMessageReason {
  NOTIFY_USER_OF_UPCOMING_AUCTION = "NOTIFY_USER_OF_UPCOMING_AUCTION",
  NOTIFY_USER_OF_STARTING_AUCTION = "NOTIFY_USER_OF_STARTING_AUCTION",
  NOTIFY_USER_OF_SUCCESSFUL_RESERVE_PRICE_PAYMENT = "NOTIFY_USER_OF_SUCCESSFUL_RESERVE_PRICE_PAYMENT",
  NOTIFY_USER_OF_SUCCESSFUL_PURCHASE_PAYMENT = "NOTIFY_USER_OF_SUCCESSFUL_PURCHASE_PAYMENT",
  NOTIFY_USER_OF_SUCCESSFUL_REFUND = "NOTIFY_USER_OF_SUCCESSFUL_REFUND",
  NOTIFY_USER_OF_UNSUCCESSFUL_RESERVE_PRICE_PAYMENT = "NOTIFY_USER_OF_UNSUCCESSFUL_RESERVE_PRICE_PAYMENT",
  NOTIFY_USER_OF_UNSUCCESSFUL_PURCHASE_PAYMENT = "NOTIFY_USER_OF_UNSUCCESSFUL_PURCHASE_PAYMENT",
  NOTIFY_USER_OF_UNSUCCESSFUL_REFUND = "NOTIFY_USER_OF_UNSUCCESSFUL_REFUND",
  NOTIFY_USER_OF_FORUM_PARTICIPATION = "NOTIFY_USER_OF_FORUM_PARTICIPATION"
}