
"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  type Auth,
  type FirebaseUser,
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
  Video,
  RefreshCw,
  Camera as CameraIcon,
  VideoOff,
  Bot,
  Loader2,
  Image as ImageIcon,
  FileUp,
  TriangleAlert,
  // Volume2, // Removed as button is removed
} from "lucide-react";

import { streamedChat, type StreamedChatInput } from "@/ai/flows/streamed-chat-flow";
import { speakText, type SpeakTextInput } from "@/ai/flows/speak-text-flow";


// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCSPxKajkhJmKM42QFmQIEX0dcE-34CDDg", 
  authDomain: "doctor-assistniat.firebaseapp.com",
  projectId: "doctor-assistniat",
  storageBucket: "doctor-assistniat.firebasestorage.app",
  messagingSenderId: "552302886860",
  appId: "1:552302886860:web:c43cc0737385503f232769",
  measurementId: "G-62SMX3D7G9"
};

interface ChatMessage {
  id?: string; 
  clientId?: string; 
  role: "user" | "model";
  text: string;
  imageUrl?: string | null;
  timestamp: Timestamp;
  isStreaming?: boolean;
}

export default function AIPoweredDoctorAssistantPage() {
  const { toast } = useToast();

  const [healthInput, setHealthInput] = useState("");
  const [base64Image, setBase64Image] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [appId, setAppId] = useState<string | null>(null);

  const appRef = useRef<FirebaseApp | null>(null);
  const authRef = useRef<Auth | null>(null);
  const dbRef = useRef<Firestore | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);


  const imageUploadRef = useRef<HTMLInputElement>(null);
  const cameraFeedRef = useRef<HTMLVideoElement>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null);

  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [currentFacingMode, setCurrentFacingMode] = useState<"user" | "environment">("user");

  const chatHistoryContainerRef = useRef<HTMLDivElement>(null);
  const healthInputForSTTRef = useRef(""); // To hold latest healthInput for STT onend

  useEffect(() => {
    healthInputForSTTRef.current = healthInput;
  }, [healthInput]);

  const showToast = useCallback((title: string, description: string, variant: "default" | "destructive" | "success" = "default") => {
    toast({ title, description, variant });
  }, [toast]);

  useEffect(() => {
    if (!appRef.current) {
      try {
        const app = initializeApp(firebaseConfig);
        appRef.current = app;
        authRef.current = getAuth(app);
        dbRef.current = getFirestore(app);
        setAppId(firebaseConfig.projectId);

        onAuthStateChanged(authRef.current, (user: FirebaseUser | null) => {
          if (user) {
            setCurrentUserId(user.uid);
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

  useEffect(() => {
    if (dbRef.current && currentUserId && appId) {
      const chatCollectionRef = collection(dbRef.current, `artifacts/${appId}/users/${currentUserId}/medical_chat_history`);
      const q = query(chatCollectionRef, orderBy("timestamp", "asc"));

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const history: ChatMessage[] = [];
        snapshot.forEach(doc => {
          const data = doc.data();
          history.push({ 
            id: doc.id, 
            ...data,
            imageUrl: data.imageUrl === undefined ? null : data.imageUrl, // Ensure null if undefined
            timestamp: data.timestamp instanceof Timestamp ? data.timestamp : Timestamp.fromDate(new Date(data.timestamp.seconds * 1000)) 
          } as ChatMessage);
        });
        setChatHistory(history);
      }, (error) => {
        console.error("Error loading chat history:", error);
        showToast("فشل تحميل سجل المحادثات", error.message, "destructive");
      });
      return () => unsubscribe();
    }
  }, [currentUserId, appId, showToast]);

   useEffect(() => {
    if (chatHistoryContainerRef.current) {
      chatHistoryContainerRef.current.scrollTop = chatHistoryContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const saveChatMessage = async (message: Omit<ChatMessage, "id" | "clientId" | "isStreaming">) => {
    if (dbRef.current && currentUserId && appId) {
      try {
        const messageToSave = {
          ...message,
          imageUrl: message.imageUrl === undefined ? null : message.imageUrl,
        };
        await addDoc(collection(dbRef.current, `artifacts/${appId}/users/${currentUserId}/medical_chat_history`), messageToSave);
      } catch (error: any) {
        console.error("Error saving chat message:", error);
        showToast("فشل حفظ الرسالة", error.message, "destructive");
      }
    }
  };
  
  const addOptimisticMessageToChat = (role: "user" | "model", text: string, imageUrlInput?: string | null, isStreaming = false): string => {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const newMessage: ChatMessage = {
      clientId,
      role,
      text,
      imageUrl: imageUrlInput === undefined ? null : imageUrlInput,
      timestamp: Timestamp.now(),
      isStreaming,
    };
  
    setChatHistory(prev => [...prev, newMessage]);
  
    if (role === 'user') {
      const { id, clientId: cId, isStreaming: _, ...messagePayload } = newMessage;
      saveChatMessage(messagePayload);
    }
    return clientId;
  };

  const updateStreamingAIMessageInChat = (clientId: string, chunk: string) => {
    setChatHistory(prev =>
      prev.map(msg =>
        msg.clientId === clientId && msg.role === 'model'
          ? { ...msg, text: msg.text + chunk }
          : msg
      )
    );
  };

  const playTextAsSpeech = useCallback(async (text: string) => {
    if (!text.trim()) return;

    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.src = '';
    }
    
    const ttsToastId = toast({ title: "تجهيز الصوت...", description: "يرجى الانتظار قليلاً.", variant: "default" });

    try {
      const ttsInput: SpeakTextInput = { text };
      const result = await speakText(ttsInput);
      
      if (result.audioContent) {
        const audioSrc = `data:audio/mp3;base64,${result.audioContent}`;
        const audio = new Audio(audioSrc);
        audioPlayerRef.current = audio;
        ttsToastId.dismiss(); // Dismiss "preparing" toast
        audio.play().catch(e => {
          console.error("Audio play failed:", e);
          showToast("خطأ في تشغيل الصوت", "لم نتمكن من تشغيل الرد الصوتي.", "destructive");
        });
        audio.onended = () => {
          // Optional: action on audio end
        };
        audio.onerror = (e) => {
          console.error("Error playing audio:", e);
          showToast("خطأ في تشغيل الصوت", "لم نتمكن من تشغيل الرد الصوتي.", "destructive");
        };
      } else {
        throw new Error("لم يتم إرجاع محتوى صوتي.");
      }
    } catch (error: any) {
      console.error("Error in Text-to-Speech:", error);
      showToast("خطأ في تحويل النص إلى كلام", error.message, "destructive");
      ttsToastId.dismiss();
    }
  }, [toast]);
  
  const finalizeStreamingAIMessageInChat = useCallback((clientId: string) => {
    let finalMessageToSave: Omit<ChatMessage, "id" | "clientId" | "isStreaming"> | null = null;
    let finalMessageTextForTTS: string | null = null;

    setChatHistory(prev =>
      prev.map(msg => {
        if (msg.clientId === clientId && msg.role === 'model') {
          const finalMessage = { ...msg, isStreaming: false };
          const { id, clientId: cId, isStreaming: _, ...messagePayload } = finalMessage;
          finalMessageToSave = messagePayload;
          finalMessageTextForTTS = finalMessage.text;
          return finalMessage;
        }
        return msg;
      })
    );
  
    if (finalMessageToSave) {
      saveChatMessage(finalMessageToSave);
    }
    if (finalMessageTextForTTS) {
      playTextAsSpeech(finalMessageTextForTTS);
    }
  }, [playTextAsSpeech]); // Added playTextAsSpeech to dependencies


  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setImagePreview(dataUrl);
        setBase64Image(dataUrl);
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

  useEffect(() => {
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
      const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognitionInstance = new SpeechRecognitionAPI();
      recognitionInstance.continuous = false; // Keep false for distinct messages
      recognitionInstance.interimResults = false; // Get final results
      recognitionInstance.lang = 'ar-SA';

      recognitionInstance.onstart = () => setIsListening(true);
      
      recognitionInstance.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setHealthInput(transcript); // Update textarea for user to see
        healthInputForSTTRef.current = transcript; // Also update ref for onend
      };

      recognitionInstance.onend = () => {
        setIsListening(false);
        if (healthInputForSTTRef.current.trim()) {
          // healthInput state might be slightly delayed, use ref for immediate value
          // setHealthInput is async, so directly call handleSendMessage
          // with the value from the ref to ensure it's the latest.
          // The Textarea will update from healthInput state.
          handleSendMessage(healthInputForSTTRef.current); 
        }
      };

      recognitionInstance.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        if (event.error !== 'no-speech') { // Ignore no-speech errors as they are common
             showToast("خطأ في التعرف على الكلام", event.error, "destructive");
        }
        setIsListening(false);
      };
      speechRecognitionRef.current = recognitionInstance;
    }
  }, [showToast]); // handleSendMessage will be wrapped in useCallback if needed

  const toggleListening = () => {
    if (!speechRecognitionRef.current) return;

    if (audioPlayerRef.current && !audioPlayerRef.current.paused) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.src = '';
    }

    if (isListening) {
      speechRecognitionRef.current.stop();
    } else {
      try {
        setHealthInput(""); 
        healthInputForSTTRef.current = "";
        speechRecognitionRef.current.start();
      } catch (e: any) {
        // Errors like "recognition already started"
        if (e.name === 'InvalidStateError') {
             showToast("الميكروفون يعمل بالفعل", "جاري الاستماع...", "default");
        } else {
            showToast("خطأ في الميكروفون", "لا يمكن بدء التعرف على الكلام.", "destructive");
            console.error("STT start error:", e);
        }
        setIsListening(false); // Ensure state is correct
      }
    }
  };

  const startCamera = async (facingMode: "user" | "environment") => {
    if (cameraStream) stopCameraInternal();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
      if (cameraFeedRef.current) {
        cameraFeedRef.current.srcObject = stream;
        cameraFeedRef.current.style.transform = (facingMode === 'user') ? 'scaleX(-1)' : 'scaleX(1)';
      }
      setCameraStream(stream);
    } catch (error: any) {
      console.error('Error accessing camera:', error);
      showToast("خطأ في الكاميرا", error.message, "destructive");
      stopCameraInternal();
    }
  };

  const stopCameraInternal = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      if (cameraFeedRef.current) cameraFeedRef.current.srcObject = null;
      setCameraStream(null);
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
      return null; 
    }
    const video = cameraFeedRef.current;
    const canvas = cameraCanvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (context) {
      if (currentFacingMode === 'user') {
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (currentFacingMode === 'user') {
        context.setTransform(1, 0, 0, 1, 0, 0);
      }
      const imageDataUrl = canvas.toDataURL('image/png');
      setBase64Image(imageDataUrl); // Set base64Image directly
      setImagePreview(imageDataUrl); 
      showToast("تم التقاط الصورة", "سترفق مع رسالتك الحالية.", "success");
      return imageDataUrl; 
    }
    return null;
  };

  const handleSendMessage = useCallback(async (sttInput?: string) => {
    const userInput = (typeof sttInput === 'string' ? sttInput : healthInput).trim();
    let currentImageToSend = base64Image; 
    const currentImagePreviewForUserMessage = imagePreview; 

    if (audioPlayerRef.current && !audioPlayerRef.current.paused) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.src = '';
    }

    if (cameraStream && !currentImageToSend) { 
      const capturedImg = captureImageFromCamera(); // This now sets base64Image
      if (capturedImg) {
        currentImageToSend = capturedImg; // Will be the same as base64Image
      }
    }
    
    if (!userInput && !currentImageToSend) {
      showToast("الإدخال مطلوب", "الرجاء كتابة رسالة أو إرفاق/التقاط صورة أو التحدث.", "destructive");
      return;
    }

    setIsLoading(true);
    if (cameraStream) stopCameraInternal();

    addOptimisticMessageToChat("user", userInput, currentImagePreviewForUserMessage || (currentImageToSend ? currentImageToSend : null) );
    const aiMessageClientId = addOptimisticMessageToChat("model", "", null, true);

    try {
      const requestPayload: StreamedChatInput = {
        prompt: userInput || (currentImageToSend ? "صف هذه الصورة." : "مرحباً"),
      };
      if (currentImageToSend) {
        requestPayload.photoDataUri = currentImageToSend;
      }

      for await (const chunkText of streamedChat(requestPayload)) {
        updateStreamingAIMessageInChat(aiMessageClientId, chunkText);
      }
      finalizeStreamingAIMessageInChat(aiMessageClientId);

    } catch (error: any) {
      console.error("Error calling AI streaming flow:", error);
      let finalErrorText = `عذراً، حدث خطأ: ${error.message}`;
      setChatHistory(prev => prev.map(msg =>
          msg.clientId === aiMessageClientId
              ? { ...msg, text: finalErrorText, isStreaming: false }
              : msg
      ));
      const errorMsgEntry = chatHistory.find(msg => msg.clientId === aiMessageClientId); // This find might be stale
      // Save the error message based on the clientId
      const errorPayloadToSave : Omit<ChatMessage, "id" | "clientId" | "isStreaming"> = {
        role: "model",
        text: finalErrorText,
        imageUrl: null,
        timestamp: Timestamp.now(),
      };
      saveChatMessage(errorPayloadToSave); // Directly save a new error message if needed or update logic

      showToast("خطأ في المحادثة", error.message, "destructive");
    } finally {
      setIsLoading(false);
      setHealthInput(""); // Clear textarea
      healthInputForSTTRef.current = ""; // Clear ref
      setBase64Image(null); 
      setImagePreview(null); 
      if (imageUploadRef.current) imageUploadRef.current.value = "";
    }
  }, [healthInput, base64Image, imagePreview, cameraStream, currentFacingMode, showToast, finalizeStreamingAIMessageInChat, chatHistory]);


  return (
    <div className="w-full max-w-3xl mx-auto">
      <Card className="container-card bg-card text-card-foreground rounded-3xl shadow-2xl border-border">
        <CardHeader className="p-6 md:p-8">
          <CardTitle className="text-3xl md:text-4xl font-extrabold text-center text-foreground mb-2">
            <Stethoscope className="inline-block h-10 w-10 text-primary mr-3" />
            مساعدك الطبي الذكي
          </CardTitle>
          <p className="text-center text-muted-foreground mb-6 text-md md:text-lg">
            تحدث مباشرة مع المساعد واحصل على ردود فورية.
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
                <div key={msg.clientId || msg.id || index} className={`chat-message ${msg.role}`}>
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
                                {msg.timestamp && new Date(msg.timestamp.seconds * 1000).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        </div>
                        <p className="text-sm font-normal text-foreground py-2 whitespace-pre-wrap">{msg.text}
                         {msg.isStreaming && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1"></span>}
                        </p>
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
          
          {/* Removed Speak Last Response Button */}

          <div className="mb-6 mt-6"> {/* Added mt-6 for spacing after chat history */}
            <Label htmlFor="healthInput" className="block text-foreground text-lg md:text-xl font-semibold mb-3">
              <ClipboardList className="inline-block h-6 w-6 text-green-400 mr-2" /> أدخل رسالتك هنا أو استخدم الميكروفون:
            </Label>
            <Textarea
              id="healthInput"
              rows={3}
              className="input-field"
              placeholder="صف حالتك أو اطرح سؤالاً..."
              value={healthInput}
              onChange={(e) => setHealthInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
            />
            <div className="mt-3 flex gap-2">
              <Button onClick={toggleListening} className={`control-btn ${isListening ? 'control-btn-red' : 'control-btn-green'}`} variant="default" size="sm" disabled={!speechRecognitionRef.current || isLoading}>
                {isListening ? <MicOff className="mr-2 h-5 w-5" /> : <Mic className="mr-2 h-5 w-5" />}
                {isListening ? 'إيقاف الاستماع' : 'تحدث (لإرسال تلقائي)'}
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
                  <input type="file" id="imageUpload" accept="image/*" onChange={handleImageUpload} ref={imageUploadRef} disabled={isLoading}/>
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
                    <Button onClick={handleStartCamera} className="control-btn control-btn-indigo" variant="default" size="sm" disabled={isLoading}>
                      <Video className="mr-2 h-5 w-5" /> تشغيل الكاميرا
                    </Button>
                  ) : (
                    <>
                      <Button onClick={handleStopCamera} className="control-btn control-btn-gray" variant="secondary" size="sm" disabled={isLoading}>
                        <VideoOff className="mr-2 h-5 w-5" /> إيقاف الكاميرا
                      </Button>
                       <Button onClick={switchCamera} className="control-btn control-btn-orange" variant="default" size="sm" disabled={isLoading}>
                        <RefreshCw className="mr-2 h-5 w-5" /> تبديل
                      </Button>
                      <Button onClick={captureImageFromCamera} className="control-btn control-btn-teal" variant="default" size="sm" disabled={isLoading}>
                        <CameraIcon className="mr-2 h-5 w-5" /> التقاط (للإرفاق)
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
            id="sendMessageBtn" 
            onClick={() => handleSendMessage()} // Ensure it's called without args for button click
            disabled={isLoading}
            className="w-full bg-primary text-primary-foreground py-3 md:py-4 rounded-xl hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition duration-300 ease-in-out text-xl md:text-2xl font-bold flex items-center justify-center shadow-lg hover:shadow-xl"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-3 h-6 w-6 animate-spin" />
                جاري الإرسال...
              </>
            ) : (
              'إرسال الرسالة'
            )}
          </Button>
          
        </CardContent>
      </Card>
    </div>
  );
}

