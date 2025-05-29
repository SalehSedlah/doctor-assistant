"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  type Auth,
  type User as FirebaseUser,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  Timestamp,
  type Firestore,
} from "firebase/firestore";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Stethoscope,
  UserCircle,
  ClipboardList,
  Mic,
  MicOff,
  Square,
  UploadCloud,
  Video,
  RefreshCw,
  Camera as CameraIcon, // Renamed to avoid conflict with Camera type
  VideoOff,
  Bot,
  Volume2,
  VolumeX,
  Loader2,
  Image as ImageIcon,
  FileUp,
  Info,
  TriangleAlert,
  CircleAlert,
} from "lucide-react";

import { analyzeHealthInput, type AnalyzeHealthInputInput, type AnalyzeHealthInputOutput } from "@/ai/flows/analyze-health-input";


// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCSPxKajkhJmKM42QFmQIEX0dcE-34CDDg", // Replace with your actual API key if different from example
  authDomain: "doctor-assistniat.firebaseapp.com",
  projectId: "doctor-assistniat",
  storageBucket: "doctor-assistniat.firebasestorage.app",
  messagingSenderId: "552302886860",
  appId: "1:552302886860:web:c43cc0737385503f232769",
  measurementId: "G-62SMX3D7G9"
};

interface ChatMessage {
  id?: string;
  role: "user" | "model";
  text: string;
  imageUrl?: string | null;
  timestamp: Timestamp;
}

export default function AIPoweredDoctorAssistantPage() {
  const { toast } = useToast();

  // State variables
  const [healthInput, setHealthInput] = useState("");
  const [base64Image, setBase64Image] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string>("image/png");


  const [isLoading, setIsLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<AnalyzeHealthInputOutput | null>(null);
  
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [appId, setAppId] = useState<string | null>(null);

  // Firebase instances
  const appRef = useRef<FirebaseApp | null>(null);
  const authRef = useRef<Auth | null>(null);
  const dbRef = useRef<Firestore | null>(null);

  // Media elements refs
  const imageUploadRef = useRef<HTMLInputElement>(null);
  const cameraFeedRef = useRef<HTMLVideoElement>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null);

  // Media stream and recognition/synthesis instances
  const [speechRecognition, setSpeechRecognition] = useState<SpeechRecognition | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechSynthesisUtterance, setSpeechSynthesisUtterance] = useState<SpeechSynthesisUtterance | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [currentFacingMode, setCurrentFacingMode] = useState<"user" | "environment">("user");

  const chatHistoryContainerRef = useRef<HTMLDivElement>(null);

  // Helper to display toast messages
  const showToast = useCallback((title: string, description: string, variant: "default" | "destructive" | "success" = "default") => {
    toast({ title, description, variant });
  }, [toast]);

  // Initialize Firebase
  useEffect(() => {
    if (!appRef.current) {
      try {
        const app = initializeApp(firebaseConfig);
        appRef.current = app;
        authRef.current = getAuth(app);
        dbRef.current = getFirestore(app);
        setAppId(firebaseConfig.projectId); // Using projectId as app identifier

        onAuthStateChanged(authRef.current, (user: FirebaseUser | null) => {
          if (user) {
            setCurrentUserId(user.uid);
            showToast("تم تسجيل الدخول", `معرف المستخدم: ${user.uid}`, "success");
          } else {
            signInAnonymously(authRef.current!).catch(error => {
              console.error("Anonymous sign-in failed:", error);
              showToast("فشل تسجيل الدخول", error.message, "destructive");
            });
          }
        });
      } catch (error: any) {
        console.error("Firebase initialization failed:", error);
        showToast("فشل تهيئة Firebase", error.message, "destructive");
      }
    }
  }, [showToast]);

  // Load chat history
  useEffect(() => {
    if (dbRef.current && currentUserId && appId) {
      const chatCollectionRef = collection(dbRef.current, `artifacts/${appId}/users/${currentUserId}/medical_chat_history`);
      const q = query(chatCollectionRef, orderBy("timestamp", "asc"));

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const history: ChatMessage[] = [];
        snapshot.forEach(doc => {
          history.push({ id: doc.id, ...doc.data() } as ChatMessage);
        });
        setChatHistory(history);
        if (history.length > 0) {
           showToast("تم تحميل سجل المحادثات", "", "default");
        }
      }, (error) => {
        console.error("Error loading chat history:", error);
        showToast("فشل تحميل سجل المحادثات", error.message, "destructive");
      });
      return () => unsubscribe();
    }
  }, [currentUserId, appId, showToast]);

  // Scroll chat to bottom
   useEffect(() => {
    if (chatHistoryContainerRef.current) {
      chatHistoryContainerRef.current.scrollTop = chatHistoryContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  // Save chat message
  const saveChatMessage = async (message: Omit<ChatMessage, "id">) => {
    if (dbRef.current && currentUserId && appId) {
      try {
        // The 'message' object already contains the Firebase Timestamp.
        // Its type Omit<ChatMessage, "id"> is suitable for addDoc.
        await addDoc(collection(dbRef.current, `artifacts/${appId}/users/${currentUserId}/medical_chat_history`), message);
      } catch (error: any) {
        console.error("Error saving chat message:", error);
        showToast("فشل حفظ الرسالة", error.message, "destructive");
      }
    }
  };

  // Add message to local state and then save
  const addMessageToChat = (role: "user" | "model", text: string, imageUrl?: string | null) => {
    const newMessage: ChatMessage = {
      role,
      text,
      imageUrl,
      timestamp: Timestamp.now(),
    };
    setChatHistory(prev => [...prev, newMessage]); // Optimistic update
    
    // Prepare payload for saveChatMessage (Omit<ChatMessage, "id">)
    const { id, ...messagePayload } = newMessage; 
    saveChatMessage(messagePayload);
  };


  // Image Upload Logic
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setImagePreview(dataUrl);
        setBase64Image(dataUrl); // Full data URI
        setImageMimeType(file.type);
        showToast("تم اختيار الصورة", "يمكنك الآن إرفاقها مع رسالتك.", "success");
      };
      reader.onerror = (error) => {
        console.error("Error reading file:", error);
        showToast("فشل قراءة الصورة", "يرجى المحاولة مرة أخرى.", "destructive");
        setBase64Image(null);
        setImagePreview(null);
      };
      reader.readAsDataURL(file);
    } else {
      setBase64Image(null);
      setImagePreview(null);
    }
  };

  // Speech Recognition
  useEffect(() => {
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
      const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognitionInstance = new SpeechRecognitionAPI();
      recognitionInstance.continuous = false;
      recognitionInstance.lang = 'ar-SA';

      recognitionInstance.onstart = () => setIsListening(true);
      recognitionInstance.onend = () => setIsListening(false);
      recognitionInstance.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setHealthInput(transcript);
        showToast("تم التعرف على الكلام", "", "success");
      };
      recognitionInstance.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        showToast("خطأ في التعرف على الكلام", event.error, "destructive");
        setIsListening(false);
      };
      setSpeechRecognition(recognitionInstance);
    } else {
      showToast("غير مدعوم", "متصفحك لا يدعم ميزة التعرف على الكلام.", "default");
    }
  }, [showToast]);

  const toggleListening = () => {
    if (!speechRecognition) return;
    if (isListening) {
      speechRecognition.stop();
    } else {
      try {
        setHealthInput(""); // Clear input before new speech
        speechRecognition.start();
      } catch (e) {
        showToast("خطأ", "الميكروفون قيد الاستخدام أو حدث خطأ.", "destructive");
      }
    }
  };

  // Speech Synthesis
  useEffect(() => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance();
      utterance.lang = 'ar-SA';
      
      speechSynthesis.onvoiceschanged = () => { // Ensure voices are loaded
          const voices = speechSynthesis.getVoices();
          const arabicVoice = voices.find(voice => voice.lang === 'ar-SA' || (voice.lang.startsWith('ar-') && voice.name.includes('Google')));
          if (arabicVoice) utterance.voice = arabicVoice;
      };
      if (speechSynthesis.getVoices().length > 0) { // If already loaded
          const voices = speechSynthesis.getVoices();
          const arabicVoice = voices.find(voice => voice.lang === 'ar-SA' || (voice.lang.startsWith('ar-') && voice.name.includes('Google')));
          if (arabicVoice) utterance.voice = arabicVoice;
      }

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = (event) => {
        console.error('Speech synthesis error:', event.error);
        showToast("خطأ في النطق", event.error.toString(), "destructive");
        setIsSpeaking(false);
      };
      setSpeechSynthesisUtterance(utterance);
    } else {
      showToast("غير مدعوم", "متصفحك لا يدعم ميزة تحويل النص إلى كلام.", "default");
    }
  }, [showToast]);

  const toggleSpeaking = () => {
    if (!speechSynthesisUtterance || !aiResponse?.summary) return;
    if (isSpeaking) {
      speechSynthesis.cancel();
    } else {
      const textToSpeak = `${aiResponse.summary}\n${aiResponse.suggestedTests || ''}`;
      if (!textToSpeak.trim() || textToSpeak.trim() === 'الاستجابة ستظهر هنا بعد الإرسال...') {
        showToast("لا يوجد نص", "لا يوجد نص لقراءته.", "default");
        return;
      }
      speechSynthesisUtterance.text = textToSpeak;
      speechSynthesis.speak(speechSynthesisUtterance);
    }
  };

  // Camera Logic
  const startCamera = async (facingMode: "user" | "environment") => {
    if (cameraStream) stopCameraInternal(); // Stop existing stream
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
      if (cameraFeedRef.current) {
        cameraFeedRef.current.srcObject = stream;
        cameraFeedRef.current.style.transform = (facingMode === 'user') ? 'scaleX(-1)' : 'scaleX(1)';
      }
      setCameraStream(stream);
      showToast("تم تشغيل الكاميرا", `الوضع: ${facingMode === 'user' ? 'أمامي' : 'خلفي'}`, "success");
    } catch (error: any) {
      console.error('Error accessing camera:', error);
      showToast("خطأ في الكاميرا", error.message, "destructive");
      stopCameraInternal();
    }
  };

  const stopCameraInternal = () => { // Renamed to avoid conflict
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      if (cameraFeedRef.current) cameraFeedRef.current.srcObject = null;
      setCameraStream(null);
      showToast("تم إيقاف الكاميرا", "", "default");
    }
  };
  
  const handleStartCamera = () => {
    startCamera(currentFacingMode);
  };

  const handleStopCamera = () => {
    stopCameraInternal();
  };

  const switchCamera = () => {
    const newFacingMode = currentFacingMode === "user" ? "environment" : "user";
    setCurrentFacingMode(newFacingMode);
    startCamera(newFacingMode);
  };

  const captureImageFromCamera = () => {
    if (!cameraStream || !cameraFeedRef.current || !cameraCanvasRef.current) {
      showToast("الكاميرا غير نشطة", "يرجى تشغيل الكاميرا أولاً.", "destructive");
      return;
    }
    const video = cameraFeedRef.current;
    const canvas = cameraCanvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (context) {
      if (currentFacingMode === 'user') { // Flip if front camera
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (currentFacingMode === 'user') { // Reset transform
        context.setTransform(1, 0, 0, 1, 0, 0);
      }
      const imageDataUrl = canvas.toDataURL('image/png');
      setBase64Image(imageDataUrl); // Full data URI
      setImagePreview(imageDataUrl);
      setImageMimeType('image/png');
      showToast("تم التقاط الصورة", "يمكنك الآن إرفاقها مع رسالتك.", "success");
    }
  };

  // AI Consultation
  const handleConsult = async () => {
    const userInput = healthInput.trim();

    if (!cameraStream && imageUploadRef.current?.files?.length === 0 && !base64Image && !userInput) {
       showToast("الإدخال مطلوب", "الرجاء وصف حالتك الصحية، أو ارفق صورة، أو التقط صورة.", "destructive");
       return;
    }
    
    // Capture from camera if active and no image uploaded/captured yet
    if (cameraStream && !base64Image) {
      captureImageFromCamera();
      // Wait a bit for state update
      await new Promise(resolve => setTimeout(resolve, 200));
      if (!base64Image && !userInput) { // Check again if image capture failed and no text
          showToast("الإدخال مطلوب", "فشل التقاط الصورة ولم يتم إدخال نص. يرجى المحاولة مرة أخرى.", "destructive");
          return;
      }
    }


    if (!userInput && !base64Image) {
      showToast("الإدخال مطلوب", "الرجاء وصف حالتك الصحية أو ارفق صورة.", "destructive");
      return;
    }

    setIsLoading(true);
    setAiResponse(null);
    showToast("جاري المعالجة", "يتم تحليل طلبك...", "default");

    // Stop media
    if (isSpeaking) speechSynthesis.cancel();
    if (cameraStream) stopCameraInternal();

    // Add user message to chat
    addMessageToChat("user", userInput, imagePreview);

    try {
      const requestPayload: AnalyzeHealthInputInput = {
        healthInput: userInput || "تحليل الصورة المرفقة.", // Provide default text if only image
      };
      if (base64Image) {
        requestPayload.photoDataUri = base64Image;
      }

      const result = await analyzeHealthInput(requestPayload);
      setAiResponse(result);
      addMessageToChat("model", `${result.summary}\n\nالاقتراحات: ${result.suggestedTests}`);
      showToast("تمت الاستشارة بنجاح", "", "success");

    } catch (error: any) {
      console.error("Error calling AI flow:", error);
      setAiResponse({summary: `عذراً، حدث خطأ: ${error.message}`, suggestedTests: 'يرجى المحاولة مرة أخرى.'});
      addMessageToChat("model", `عذراً، حدث خطأ أثناء معالجة طلبك: ${error.message}`);
      showToast("خطأ في الاستشارة", error.message, "destructive");
    } finally {
      setIsLoading(false);
      setHealthInput("");
      setBase64Image(null);
      setImagePreview(null);
      if (imageUploadRef.current) imageUploadRef.current.value = ""; // Clear file input
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      <Card className="container-card bg-card text-card-foreground rounded-3xl shadow-2xl border-border">
        <CardHeader className="p-6 md:p-8">
          <CardTitle className="text-3xl md:text-4xl font-extrabold text-center text-foreground mb-2">
            <Stethoscope className="inline-block h-10 w-10 text-primary mr-3" />
            مساعدك الطبي الذكي
          </CardTitle>
          <p className="text-center text-muted-foreground mb-6 text-md md:text-lg">
            صف حالتك أو أرسل فحوصاتك للحصول على معلومات عامة مفصلة.
          </p>
        </CardHeader>

        <CardContent className="p-6 md:p-8">
          <Alert variant="destructive" className="disclaimer-box mb-8">
            <TriangleAlert className="h-5 w-5" />
            <AlertTitle className="font-bold text-lg md:text-xl block mb-2">تنبيه هام جداً:</AlertTitle>
            <AlertDescription className="text-base md:text-lg">
              هذه المعلومات لأغراض تعليمية وعامة فقط، ولا تحل محل الاستشارة الطبية المتخصصة.
              <strong> الذكاء الاصطناعي لا يمكنه تشخيص الأمراض أو وصف الأدوية أو تقديم نصيحة طبية حقيقية.</strong>
              يجب دائمًا استشارة طبيب مؤهل للحصول على تشخيص دقيق وخطة علاج مناسبة.
              <span className="block mt-3 font-bold">يرجى عدم تحميل أي صور أو معلومات صوتية أو نصية تحتوي على معلومات شخصية حساسة أو بيانات مرضى حقيقيين.</span>
              <span className="block mt-3 font-bold">لا يتم تخزين أي صور أو مقاطع فيديو من الكاميرا على أي خادم.</span>
            </AlertDescription>
          </Alert>

          {currentUserId && (
            <div className="user-id-display">
              <UserCircle className="inline-block h-5 w-5 mr-2" />
              <span>معرف المستخدم: </span><span>{currentUserId}</span>
            </div>
          )}

          <ScrollArea className="chat-history-container h-[300px] md:h-[400px] rounded-xl p-4" ref={chatHistoryContainerRef}>
            {chatHistory.length === 0 ? (
              <p className="text-muted-foreground text-center py-10">ابدأ محادثتك مع المساعد الطبي...</p>
            ) : (
              chatHistory.map((msg, index) => (
                <div key={msg.id || index} className={`chat-message ${msg.role}`}>
                  <div className="flex items-start gap-2.5">
                     {msg.role === 'user' ? 
                        <UserCircle className="h-6 w-6 text-muted-foreground shrink-0" /> : 
                        <Bot className="h-6 w-6 text-primary shrink-0" />
                     }
                    <div className="flex flex-col w-full max-w-[calc(100%-3rem)] leading-1.5">
                        <div className="flex items-center space-x-2 rtl:space-x-reverse mb-1">
                            <span className="text-sm font-semibold text-foreground">
                                {msg.role === 'user' ? 'أنت' : 'المساعد'}
                            </span>
                            <span className="text-xs font-normal text-muted-foreground">
                                {new Date(msg.timestamp.seconds * 1000).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        </div>
                        <p className="text-sm font-normal text-foreground py-2">{msg.text}</p>
                        {msg.imageUrl && (
                            <div className="mt-2">
                            <Image src={msg.imageUrl} alt="صورة مرفقة" width={200} height={200} className="rounded-lg object-contain" data-ai-hint="medical scan" />
                            </div>
                        )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </ScrollArea>

          <div className="mb-6">
            <Label htmlFor="healthInput" className="block text-foreground text-lg md:text-xl font-semibold mb-3">
              <ClipboardList className="inline-block h-6 w-6 text-green-400 mr-2" /> أدخل رسالتك هنا:
            </Label>
            <Textarea
              id="healthInput"
              rows={3}
              className="input-field"
              placeholder="صف حالتك أو اطرح سؤالاً..."
              value={healthInput}
              onChange={(e) => setHealthInput(e.target.value)}
            />
            <div className="mt-3 flex gap-2">
              <Button onClick={toggleListening} className={`control-btn ${isListening ? 'control-btn-red' : 'control-btn-green'}`} variant="default" size="sm" disabled={!speechRecognition}>
                {isListening ? <MicOff className="mr-2 h-5 w-5" /> : <Mic className="mr-2 h-5 w-5" />}
                {isListening ? 'إيقاف الاستماع' : 'تحدث'}
              </Button>
            </div>
          </div>

          <div className="mb-8">
            <Label className="block text-foreground text-lg md:text-xl font-semibold mb-3">
              <ImageIcon className="inline-block h-6 w-6 text-purple-400 mr-2" /> أو ارفق صورة (اختياري):
            </Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              <div>
                <Label htmlFor="imageUpload" className="block text-muted-foreground text-md md:text-lg font-medium mb-2">
                  تحميل من ملف:
                </Label>
                <div className="file-input-custom">
                  <input type="file" id="imageUpload" accept="image/*" onChange={handleImageUpload} ref={imageUploadRef} />
                  <label htmlFor="imageUpload">
                    <FileUp className="h-5 w-5" /> اختر ملف
                  </label>
                </div>
              </div>
              <div>
                <Label className="block text-muted-foreground text-md md:text-lg font-medium mb-2">
                  التقاط من الكاميرا:
                </Label>
                <div className="flex flex-wrap gap-2">
                  {!cameraStream ? (
                    <Button onClick={handleStartCamera} className="control-btn control-btn-indigo" variant="default" size="sm">
                      <Video className="mr-2 h-5 w-5" /> تشغيل الكاميرا
                    </Button>
                  ) : (
                    <>
                      <Button onClick={handleStopCamera} className="control-btn control-btn-gray" variant="secondary" size="sm">
                        <VideoOff className="mr-2 h-5 w-5" /> إيقاف الكاميرا
                      </Button>
                       <Button onClick={switchCamera} className="control-btn control-btn-orange" variant="default" size="sm">
                        <RefreshCw className="mr-2 h-5 w-5" /> تبديل
                      </Button>
                      <Button onClick={captureImageFromCamera} className="control-btn control-btn-teal" variant="default" size="sm">
                        <CameraIcon className="mr-2 h-5 w-5" /> التقاط
                      </Button>
                    </>
                  )}
                </div>
                {cameraStream && (
                  <div className="video-container-active mt-4 rounded-lg overflow-hidden">
                    <video ref={cameraFeedRef} autoPlay playsInline className="w-full h-auto aspect-video bg-black"></video>
                    <canvas ref={cameraCanvasRef} style={{ display: 'none' }}></canvas>
                  </div>
                )}
              </div>
            </div>
            {imagePreview && (
              <div className="image-preview-container mt-6 flex justify-center items-center h-48 p-2">
                <Image src={imagePreview} alt="معاينة الصورة" width={180} height={180} className="max-h-full max-w-full object-contain rounded-lg" data-ai-hint="medical image" />
              </div>
            )}
          </div>

          <Button
            id="consultBtn"
            onClick={handleConsult}
            disabled={isLoading}
            className="w-full bg-primary text-primary-foreground py-3 md:py-4 rounded-xl hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition duration-300 ease-in-out text-xl md:text-2xl font-bold flex items-center justify-center shadow-lg hover:shadow-xl"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-3 h-6 w-6 animate-spin" />
                جاري المعالجة...
              </>
            ) : (
              'إرسال الرسالة'
            )}
          </Button>

          {aiResponse && (
            <div className="mt-10 p-4 md:p-6 bg-card rounded-xl shadow-md border border-border ai-response-area">
              <h3 className="text-lg md:text-xl font-bold text-foreground mb-4">
                <Bot className="inline-block h-6 w-6 text-primary mr-2" /> آخر استجابة من المساعد الطبي:
              </h3>
              <div className="text-muted-foreground leading-relaxed whitespace-pre-wrap text-base md:text-lg">
                <p><strong>ملخص:</strong> {aiResponse.summary}</p>
                {aiResponse.suggestedTests && <p className="mt-2"><strong>الاقتراحات:</strong> {aiResponse.suggestedTests}</p>}
              </div>
              <div className="mt-4 flex gap-2">
                 <Button onClick={toggleSpeaking} className={`control-btn ${isSpeaking ? 'control-btn-red' : 'control-btn-green'}`} variant="default" size="sm" disabled={!speechSynthesisUtterance || !aiResponse?.summary}>
                  {isSpeaking ? <VolumeX className="mr-2 h-5 w-5" /> : <Volume2 className="mr-2 h-5 w-5" />}
                  {isSpeaking ? 'إيقاف القراءة' : 'استمع'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
