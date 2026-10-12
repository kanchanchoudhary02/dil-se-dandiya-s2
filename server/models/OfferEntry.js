import mongoose from 'mongoose';
const OfferEntrySchema=new mongoose.Schema({
 name:{type:String,required:true,trim:true,maxlength:100},
 phone:{type:String,required:true,unique:true,index:true,match:/^[6-9]\d{9}$/},
 code:{type:String,required:true,unique:true,index:true},
 visits:{type:Number,default:1},
 isScratched:{type:Boolean,default:false},
 scratchResult:{type:String,default:null},
 scratchedAt:{type:Date,default:null},
 ip:{type:String,default:null},
 createdAt:{type:Date,default:Date.now},
 lastSeen:{type:Date,default:Date.now}
},{versionKey:false});
export default mongoose.model('OfferEntry',OfferEntrySchema);
