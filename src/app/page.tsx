
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
  Upload, 
  ImageIcon as ImageIconLucide, 
  TriangleAlert,
  Send, 
} from "lucide-react";

// Firebase configuration - Remains the same
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
  role: "user" | "model";
  text: string;
  imageUrl?: string | null;
  timestamp: Timestamp;
  isStreaming?: boolean;
}

interface LocalChatMessageForAPI {
  role: "user" | "model";
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string; } }>;
  timestamp?: string; 
}


export default function AIPoweredDoctorAssistantPage() {
  const [healthInput, setHealthInput] = useState("");
  const [base64Image, setBase64Image] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [localChatHistoryForAPI, setLocalChatHistoryForAPI] = useState<LocalChatMessageForAPI[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [appId, setAppId] = useState<string | null>(null);

  const appRef = useRef<FirebaseApp | null>(null);
  const authRef = useRef<Auth | null>(null);
  const dbRef = useRef<Firestore | null>(null);

  const imageUploadRef = useRef<HTMLInputElement>(null);
  const cameraFeedRef = useRef<HTMLVideoElement>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null);
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [currentFacingMode, setCurrentFacingMode] = useState<"user" | "environment">("user");

  const chatHistoryContainerRef = useRef<HTMLDivElement>(null);
  const messageBoxRef = useRef<HTMLDivElement>(null);
  const messageTextRef = useRef<HTMLParagraphElement>(null);

  const displayMessage = useCallback((message: string, type: 'info' | 'error' | 'warning' = 'info') => {
    if (messageBoxRef.current && messageTextRef.current) {
      messageTextRef.current.textContent = message;
      messageBoxRef.current.className = `message-box-global ${type}`;
      messageBoxRef.current.classList.remove('hidden');
      setTimeout(() => {
        if (messageBoxRef.current) {
          messageBoxRef.current.classList.add('hidden');
        }
      }, 7000);
    }
  }, []);

  const saveChatMessage = useCallback(async (message: Omit<ChatMessage, "id" | "isStreaming">) => {
    if (dbRef.current && currentUserId && appId) {
      try {
        await addDoc(collection(dbRef.current, `artifacts/${appId}/users/${currentUserId}/medical_chat_history`), {
          ...message,
          imageUrl: message.imageUrl === undefined ? null : message.imageUrl,
        });
      } catch (error: any) {
        console.error("Error saving chat message:", error);
        displayMessage(`فشل حفظ الرسالة: ${error.message}`, "error");
      }
    }
  }, [currentUserId, appId, displayMessage]);

  const addOptimisticMessageToChat = useCallback((role: "user" | "model", text: string, imageUrlForDisplay?: string | null, isStreaming = false): string => {
    const clientMessageId = `${Date.now()}-${Math.random()}`;
    const newMessageForUI: ChatMessage = {
      id: clientMessageId,
      role,
      text,
      imageUrl: imageUrlForDisplay === undefined ? null : (imageUrlForDisplay || null),
      timestamp: Timestamp.now(),
      isStreaming,
    };
    setChatHistory(prev => [...prev, newMessageForUI]);

    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string; } }> = [];
    if (text) parts.push({ text });
    
    // Use base64Image for API if this is a user message being sent
    if (role === 'user' && base64Image && imageUrlForDisplay) {
      const mimeType = imageUploadRef.current?.files?.[0]?.type || (base64Image.startsWith('data:image/png') ? 'image/png' : (base64Image.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png'));
      const b64Data = base64Image.split(',')[1];
      if (b64Data) parts.push({ inlineData: { mimeType, data: b64Data } });
    }


    if (parts.length > 0) {
      const newMessageForAPI: LocalChatMessageForAPI = {
        role,
        parts,
        timestamp: new Date().toISOString()
      };
      setLocalChatHistoryForAPI(prev => [...prev, newMessageForAPI]);
    }
    
    if (role === 'user' && !isStreaming) {
      saveChatMessage({ role, text, imageUrl: newMessageForUI.imageUrl, timestamp: newMessageForUI.timestamp });
    }
    return clientMessageId;
  }, [base64Image, saveChatMessage]);


  const updateStreamingAIMessageInChat = useCallback((clientMessageId: string, chunkText: string) => {
    setChatHistory(prev => prev.map(msg =>
      msg.id === clientMessageId ? { ...msg, text: (msg.text || "") + chunkText, isStreaming: true } : msg
    ));
  }, []);

  const finalizeStreamingAIMessageInChat = useCallback((clientMessageId: string) => {
    let finalMessage: ChatMessage | undefined;
    setChatHistory(prev => {
      const updatedHistory = prev.map(msg => {
        if (msg.id === clientMessageId) {
          finalMessage = { ...msg, isStreaming: false };
          return finalMessage;
        }
        return msg;
      });
      return updatedHistory;
    });

    if (finalMessage) {
      saveChatMessage({ role: finalMessage.role, text: finalMessage.text, imageUrl: finalMessage.imageUrl, timestamp: finalMessage.timestamp });
    }
  }, [saveChatMessage]);


  const stopCameraInternal = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      if (cameraFeedRef.current) cameraFeedRef.current.srcObject = null;
      setCameraStream(null);
      displayMessage('تم إيقاف الكاميرا.', 'info');
    }
  }, [cameraStream, displayMessage]);

  const captureImageFromCamera = useCallback(() => {
    if (!cameraStream || !cameraFeedRef.current || !cameraCanvasRef.current) {
      displayMessage("الكاميرا غير نشطة. يرجى تشغيل الكاميرا أولاً.", "error");
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
      setBase64Image(imageDataUrl); // This is the full data URI
      setImagePreview(imageDataUrl);
      displayMessage("تم التقاط الصورة بنجاح!", "info");
      return imageDataUrl;
    }
    return null;
  }, [cameraStream, currentFacingMode, displayMessage]);


  const handleSendMessage = useCallback(async (sttInput?: string) => {
    const userInput = (typeof sttInput === 'string' ? sttInput : healthInput).trim();
    let currentImageToSendWithUserMessage = base64Image; // This holds the full data URI

    const apiKey = "AIzaSyAWTysN_zMdRn-MVt6mv9XxbcG0vAt7ujc"; 
    
    if (!apiKey) {
      displayMessage("خطأ: مفتاح Gemini API غير موجود أو فارغ. يرجى إضافته في الكود (page.tsx) للمتابعة.", "error");
      setIsLoading(false); 
      return;
    }

    if (cameraStream && !currentImageToSendWithUserMessage) {
      const capturedImg = captureImageFromCamera();
      if (capturedImg) {
        currentImageToSendWithUserMessage = capturedImg; // capturedImg is also full data URI
        await new Promise(resolve => setTimeout(resolve, 100)); 
      }
    }

    if (!userInput && !currentImageToSendWithUserMessage) {
      displayMessage("الرجاء كتابة رسالة أو إرفاق/التقاط صورة أو التحدث.", "error");
      return;
    }

    setIsLoading(true);
    if (cameraStream) stopCameraInternal();

    addOptimisticMessageToChat("user", userInput, imagePreview); // imagePreview is the data URI for display
    
    const systemPrompt = `
أنت مساعد طبي افتراضي ذكي ومحادث. مهمتك هي التفاعل مع المستخدمين وتقديم معلومات عامة **مفصلة ودقيقة قدر الإمكان** بناءً على وصفهم (نص أو صوت) وأي صور يشاركونها (مثل فحوصات أو ملاحظات مرئية).
**تذكر: لا تقدم تشخيصًا، لا تصف أدوية، ولا تقدم نصيحة طبية مباشرة أو شخصية.**
**دائماً وبشكل واضح، اطلب من المستخدم استشارة طبيب مؤهل للحصول على تشخيص دقيق وخطة علاج مناسبة.**

**قاعدة أساسية:** إذا كان استفسار المستخدم أو سياق المحادثة **خارج نطاق الطب أو الصحة تمامًا**، يجب أن ترد بالرسالة التالية فقط:
"عذراً، أنا هنا لمساعدتك في الأمور الطبية والصحية فقط. يرجى طرح سؤال متعلق بالصحة."

**تعليمات خاصة للمحادثة (إذا كان الاستفسار طبيًا):**
* حافظ على نبرة محادثة وودودة، وكأنك تتحدث مباشرة مع المريض.
* استخدم لغة طبيعية، وتجنب العبارات الرسمية أو السريرية المفرطة إلا إذا كانت ضرورية للوضوح.
* ابدأ ردك دائمًا بتحية قصيرة أو عبارة افتتاحية ودودة (مثال: "أهلاً بك! بناءً على ما ذكرت...", "مرحباً! لفهم حالتك بشكل أفضل...").
* **إذا كانت المعلومات الأولية غير كافية لتقديم استجابة مفصلة، اطرح أسئلة محددة وموجهة للمريض لجمع المزيد من التفاصيل.**
    * **ركز على أسئلة حول:** مدة الأعراض، شدتها، العوامل التي تزيدها أو تخففها، الأعراض المصاحبة الأخرى، التاريخ الطبي السابق ذي الصلة، الأدوية الحالية، الحساسية.
    * **مثال على سؤال:** "هل يمكنك وصف الألم بشكل أدق؟ هل هو حاد أم خفيف؟ هل ينتشر إلى مناطق أخرى؟"
    * **لا تطلب فحوصات في كل مرة.** اطلبها فقط إذا كانت المعلومات غير كافية بشكل واضح بعد طرح الأسئلة.
* إذا قدم المستخدم أعراضًا (نصية أو مرئية):
    1.  **اذكر بشكل مفصل** بعض الأمراض أو الحالات المحتملة التي قد تتوافق مع الأعراض المذكورة، مع شرح موجز لكل منها.
        * **ركز على الاحتمالات الشائعة أو الأكثر ملاءمة للأعراض المذكورة.**
        * **اذكر سبب كون كل احتمال واردًا بناءً على الأعراض المقدمة.**
        * **تجنب ذكر احتمالات عشوائية أو نادرة جدًا ما لم تكن الأعراض تشير إليها بوضوح.**
    2.  **اقترح أنواعًا محددة وواضحة** من الفحوصات الطبية التي قد تكون ضرورية لتشخيص هذه الحالات، مع شرح موجز لغرض كل فحص وكيف يمكن أن يساعد في التمييز بين الاحتمالات.
    3.  **اذكر فئات الأدوية العامة** التي تستخدم عادة لعلاج هذه الحالات، مع إعطاء أمثلة لفئات الأدوية (مثل المضادات الحيوية، مضادات الالتهاب، خافضات الحرارة) وشرح موجز لآلية عملها بشكل عام.
* إذا أرسل المريض فحصًا طبيًا أو تقريرًا (بيانات مختبر، نتائج أشعة، نص أو صورة):
    1.  **اشرح بالتفصيل** ما قد تعنيه النتائج المذكورة أو المرئية في الفحص بشكل عام، مع الإشارة إلى القيم الطبيعية (إذا كانت ذات صلة) وما قد تشير إليه القيم غير الطبيعية.
    2.  **اذكر فئات الأدوية العامة** التي قد تكون ذات صلة بالحالات التي قد تشير إليها نتائج الفحص، مع شرح موجز لآلية عملها بشكل عام.
* إذا كانت الصورة غير واضحة أو غير كافية: اطلب من المستخدم توضيح الصورة أو تقديم المزيد من التفاصيل النصية.
* **انهِ كل رد بتذكير واضح ومباشر:** "ملاحظة هامة جداً: هذه المعلومات هي لأغراض تعليمية وعامة فقط، ولا تحل محل الاستشارة الطبية المتخصصة. يجب دائمًا استشارة طبيب مؤهل للحصول على تشخيص دقيق وخطة علاج مناسبة."

الرسالة الحالية من المستخدم:
${userInput}
`;
    const contentsForAPI: any[] = [];

    localChatHistoryForAPI.forEach(msg => {
      if (msg.role !== "user" || !msg.parts.some(p => p.text?.includes("الرسالة الحالية من المستخدم:"))) {
        contentsForAPI.push({ role: msg.role, parts: msg.parts });
      }
    });

    const currentUserParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string; } }> = [];
    if (userInput) currentUserParts.push({ text: systemPrompt }); // System prompt is prepended to user's text
    else if (currentImageToSendWithUserMessage) currentUserParts.push({ text: "صف هذه الصورة من فضلك. " + systemPrompt });


    if (currentImageToSendWithUserMessage) {
       // currentImageToSendWithUserMessage is already the full data URI
      const mimeTypeMatch = currentImageToSendWithUserMessage.match(/^data:(image\/[a-zA-Z+]+);base64,/);
      const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/png';
      const b64Data = currentImageToSendWithUserMessage.split(',')[1];
      if (b64Data) currentUserParts.push({ inlineData: { mimeType, data: b64Data } });
    }

    if (currentUserParts.length > 0) {
      contentsForAPI.push({ role: "user", parts: currentUserParts });
    }

    const payload = { contents: contentsForAPI };
    
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

    setHealthInput("");
    setBase64Image(null);
    setImagePreview(null);
    if (imageUploadRef.current) imageUploadRef.current.value = "";
    
    const aiMessageClientId = addOptimisticMessageToChat("model", "جاري الكتابة...", null, true);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let errorBodyContent = `Status: ${response.status} ${response.statusText}`;
        try {
          const errorBodyJson = await response.json();
          console.error("API Error JSON Response:", errorBodyJson); 
          if (Object.keys(errorBodyJson).length === 0 && errorBodyJson.constructor === Object) {
            errorBodyContent = `API request failed with status ${response.status}. The server returned an empty error response. Please check your API key, network, and that the Gemini API is enabled for your project.`;
          } else {
            errorBodyContent = errorBodyJson?.error?.message || JSON.stringify(errorBodyJson) || `Status: ${response.status}`;
          }
        } catch (jsonError) {
          console.warn("Failed to parse API error response as JSON:", jsonError);
          try {
            const rawErrorText = await response.text();
            console.error("API Error Raw Text Response:", rawErrorText);
            errorBodyContent = rawErrorText || errorBodyContent;
          } catch (textError) {
            console.warn("Failed to read API error response as text:", textError);
          }
        }
        throw new Error(`API request failed. ${errorBodyContent}`);
      }

      const result = await response.json();

      if (result.candidates && result.candidates.length > 0 &&
        result.candidates[0].content && result.candidates[0].content.parts &&
        result.candidates[0].content.parts.length > 0) {
        const aiTextResponse = result.candidates[0].content.parts[0].text || "لم يتمكن المساعد من إنشاء رد نصي.";
        
        setChatHistory(prev => prev.map(msg => 
            msg.id === aiMessageClientId ? { ...msg, text: aiTextResponse, isStreaming: false } : msg
        ));
        
        const finalAIMsgFromHistory = chatHistory.find(msg => msg.id === aiMessageClientId);
        if (finalAIMsgFromHistory) { // Should always be true now
             saveChatMessage({ role: "model", text: aiTextResponse, imageUrl: null, timestamp: finalAIMsgFromHistory.timestamp });
        } else { 
             saveChatMessage({ role: "model", text: aiTextResponse, imageUrl: null, timestamp: Timestamp.now() });
        }

        displayMessage('تمت الاستشارة بنجاح!', 'info');
      } else {
        console.error("Unexpected API response structure:", result);
        const errMsg = 'حدث خطأ في معالجة طلبك أو كانت الاستجابة فارغة.';
        setChatHistory(prev => prev.map(msg => 
            msg.id === aiMessageClientId ? { ...msg, text: errMsg, isStreaming: false } : msg
        ));
        saveChatMessage({ role: "model", text: errMsg, imageUrl: null, timestamp: Timestamp.now() });
        displayMessage(errMsg, 'error');
      }
    } catch (error: any) {
      console.error("Error calling Gemini API:", error);
      const errMsg = `خطأ في الاتصال بالذكاء الاصطناعي: ${error.message}`;
      setChatHistory(prev => prev.map(msg => 
        msg.id === aiMessageClientId ? { ...msg, text: errMsg, isStreaming: false } : msg
      ));
      saveChatMessage({ role: "model", text: errMsg, imageUrl: null, timestamp: Timestamp.now() });
      displayMessage(errMsg, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [
    healthInput, base64Image, imagePreview, cameraStream, currentFacingMode,
    displayMessage, addOptimisticMessageToChat, saveChatMessage, stopCameraInternal,
    captureImageFromCamera, localChatHistoryForAPI, updateStreamingAIMessageInChat, finalizeStreamingAIMessageInChat, chatHistory
  ]);


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
              displayMessage(`فشل تسجيل الدخول: ${error.message}`, "error");
            });
          }
        });
      } catch (error: any) {
        console.error("Firebase initialization failed:", error);
        displayMessage(`فشل تهيئة Firebase: ${error.message}`, "error");
      }
    }
  }, [displayMessage]);

  useEffect(() => {
    if (dbRef.current && currentUserId && appId) {
      const chatCollectionRef = collection(dbRef.current, `artifacts/${appId}/users/${currentUserId}/medical_chat_history`);
      const q = query(chatCollectionRef, orderBy("timestamp", "asc"));

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const newHistoryFromDB: ChatMessage[] = [];
        const newLocalHistoryForAPI: LocalChatMessageForAPI[] = [];

        snapshot.forEach(doc => {
          const data = doc.data();
          const messageForUI: ChatMessage = {
            id: doc.id,
            role: data.role,
            text: data.text,
            imageUrl: data.imageUrl === undefined ? null : data.imageUrl,
            timestamp: data.timestamp
          };
          newHistoryFromDB.push(messageForUI);

          const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string; } }> = [];
          if (data.text) parts.push({ text: data.text });
          if (data.imageUrl) {
            // Assuming imageUrl is stored as a data URI
            const mimeTypeMatch = data.imageUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/);
            const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/png';
            const b64Data = data.imageUrl.split(',')[1];
            if (b64Data) {
              parts.push({ inlineData: { mimeType, data: b64Data } });
            }
          }
          if (parts.length > 0) {
            newLocalHistoryForAPI.push({ role: data.role, parts });
          }
        });
        setChatHistory(newHistoryFromDB);
        setLocalChatHistoryForAPI(newLocalHistoryForAPI);

        if (!snapshot.metadata.hasPendingWrites) { 
            if (snapshot.empty) {
                displayMessage('تم تحميل سجل المحادثات وهو فارغ حاليًا.', 'info');
            } else {
                displayMessage('تم تحميل سجل المحادثات.', 'info');
            }
        }

      }, (error) => {
        console.error("Error loading chat history:", error);
        displayMessage(`فشل تحميل سجل المحادثات: ${error.message}`, "error");
      });
      return () => unsubscribe();
    }
  }, [currentUserId, appId, displayMessage]);

  useEffect(() => {
    if (chatHistoryContainerRef.current) {
      chatHistoryContainerRef.current.scrollTop = chatHistoryContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  useEffect(() => {
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
      const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      speechRecognitionRef.current = new SpeechRecognitionAPI();
      
      if (speechRecognitionRef.current) {
        const currentRecognition = speechRecognitionRef.current;
        currentRecognition.continuous = true;
        currentRecognition.interimResults = true;
        currentRecognition.lang = 'ar-SA';

        currentRecognition.onstart = () => {
          setIsListening(true);
          displayMessage('الاستماع المستمر... تحدث الآن.', 'info');
          setHealthInput('');
        };

        currentRecognition.onresult = (event: any) => {
          let currentTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            currentTranscript += event.results[i][0].transcript;
          }
          setHealthInput(currentTranscript);
        };

        currentRecognition.onend = () => {
          setIsListening(false);
          displayMessage('توقف الاستماع.', 'info');
          // Do not automatically send, user will click send button
        };

        currentRecognition.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          if (event.error !== 'no-speech' && event.error !== 'aborted') {
            displayMessage(`خطأ في التعرف على الكلام: ${event.error}`, "error");
          } else if (event.error === 'no-speech') {
            displayMessage('لم يتم اكتشاف أي كلام.', 'warning');
          }
          setIsListening(false);
        };
      }
    } else {
      displayMessage('متصفحك لا يدعم ميزة التعرف على الكلام.', 'warning');
    }

    return () => {
      if (speechRecognitionRef.current && isListening) {
        speechRecognitionRef.current.stop();
      }
    };
  }, [displayMessage, isListening]); 

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setImagePreview(dataUrl);
        setBase64Image(dataUrl); // Store the full data URI
        displayMessage("تم اختيار الصورة.", "info");
      };
      reader.onerror = (error) => {
        console.error("Error reading file:", error);
        displayMessage("فشل قراءة الصورة.", "error");
        setBase64Image(null);
        setImagePreview(null);
      };
      reader.readAsDataURL(file);
    } else {
      setBase64Image(null);
      setImagePreview(null);
    }
  };

  const toggleListening = () => {
    if (!speechRecognitionRef.current) return;
    if (isListening) {
      speechRecognitionRef.current.stop();
    } else {
      try {
        setHealthInput("");
        speechRecognitionRef.current.start();
      } catch (e: any) {
        displayMessage(`خطأ في بدء الميكروفون: ${e.message}`, "error");
        setIsListening(false);
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
      displayMessage(`تم تشغيل الكاميرا (${facingMode === 'user' ? 'أمامية' : 'خلفية'}).`, 'info');
    } catch (error: any) {
      console.error('Error accessing camera:', error);
      displayMessage(`خطأ في الكاميرا: ${error.message}`, "error");
      stopCameraInternal();
    }
  };

  const handleStartCamera = () => {
    startCamera(currentFacingMode);
  };

  const switchCamera = () => {
    const newFacingMode = currentFacingMode === "user" ? "environment" : "user";
    setCurrentFacingMode(newFacingMode);
    startCamera(newFacingMode);
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      <Card className="container-card">
        <CardHeader className="p-6 md:p-8">
          <CardTitle className="text-3xl md:text-4xl font-extrabold text-center text-gray-100 mb-2">
            <Stethoscope className="inline-block h-10 w-10 text-blue-400 mr-3" />
            مساعدك الطبي الذكي
          </CardTitle>
          <p className="text-center text-gray-300 mb-6 text-md md:text-lg">
            صف حالتك أو أرسل فحوصاتك للحصول على معلومات عامة مفصلة.
          </p>
        </CardHeader>

        <CardContent className="p-6 md:p-8 pt-0">
          <Alert variant="destructive" className="disclaimer-box mb-8">
            <TriangleAlert className="h-5 w-5" />
            <AlertTitle className="font-bold text-xl block mb-2">تنبيه هام جداً:</AlertTitle>
            <AlertDescription className="text-lg">
              هذه المعلومات لأغراض تعليمية وعامة فقط، ولا تحل محل الاستشارة الطبية المتخصصة.
              <strong> الذكاء الاصطناعي لا يمكنه تشخيص الأمراض أو وصف الأدوية أو تقديم نصيحة طبية حقيقية.</strong>
              يجب دائمًا استشارة طبيب مؤهل للحصول على تشخيص دقيق وخطة علاج مناسبة.
              <span className="block mt-3 font-bold">يرجى عدم تحميل أي صور أو معلومات صوتية أو نصية تحتوي على معلومات شخصية حساسة أو بيانات مرضى حقيقيين.</span>
              <span className="block mt-3 font-bold">لا يتم تخزين أي صور أو مقاطع فيديو من الكاميرا على أي خادم.</span>
            </AlertDescription>
          </Alert>

          {currentUserId && (
            <div id="userIdDisplay" className="user-id-display">
              <UserCircle className="inline-block h-5 w-5 mr-2" />
              <span>معرف المستخدم: </span><span id="currentUserIdSpan">{currentUserId}</span>
            </div>
          )}

          <ScrollArea className="chat-history-container" ref={chatHistoryContainerRef}>
            {chatHistory.length === 0 ? (
              <p className="text-gray-400 text-center py-10">ابدأ محادثتك مع المساعد الطبي...</p>
            ) : (
              chatHistory.map((msg) => (
                <div key={msg.id} className={`chat-message ${msg.role === 'user' ? 'user' : 'ai'}`}>
                  <div className="flex items-start gap-2.5">
                    {msg.role === 'user' ?
                      <UserCircle className="h-6 w-6 text-gray-400 shrink-0" /> :
                      <Bot className="h-6 w-6 text-blue-400 shrink-0" />
                    }
                    <div className="flex flex-col w-full max-w-[calc(100%-3rem)] leading-1.5">
                      <div className="flex items-center space-x-2 rtl:space-x-reverse mb-1">
                        <span className="text-sm font-semibold text-gray-100">
                          {msg.role === 'user' ? 'أنت' : 'المساعد'}
                        </span>
                        <span className="text-xs font-normal text-gray-500">
                          {msg.timestamp && new Date(msg.timestamp.seconds * 1000).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-sm font-normal text-gray-100 py-2 whitespace-pre-wrap">
                        {msg.isStreaming && msg.role === 'model' && msg.text === "جاري الكتابة..." ? 
                            <span className="italic opacity-75">{msg.text}</span> : 
                            msg.text
                        }
                      </p>
                      {msg.imageUrl && (
                        <div className="mt-2">
                          <Image src={msg.imageUrl} alt="صورة مرفقة" width={200} height={200} className="rounded-lg object-contain border border-gray-600" data-ai-hint="medical scan"/>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </ScrollArea>

          <div className="mb-6 mt-6">
            <Label htmlFor="healthInput" className="block text-gray-100 text-xl font-semibold mb-3">
              <ClipboardList className="inline-block h-6 w-6 text-green-400 mr-2" />
              أدخل رسالتك هنا:
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
              <Button onClick={toggleListening} id="microphoneBtn" className={`control-btn ${isListening ? 'control-btn-red' : 'control-btn-green'}`} variant="default" size="default" disabled={!speechRecognitionRef.current || isLoading}>
                {isListening ? <MicOff className="mr-2 h-5 w-5" /> : <Mic className="mr-2 h-5 w-5" />}
                {isListening ? 'إيقاف الاستماع' : 'التقاط الصوت'}
              </Button>
            </div>
          </div>

          <div className="mb-8">
            <Label className="block text-gray-100 text-xl font-semibold mb-3">
              <ImageIconLucide className="inline-block h-6 w-6 text-purple-400 mr-2" />
              أو ارفق صورة (اختياري):
            </Label>
            <div className="flex flex-col md:flex-row items-start justify-center gap-6">
              <div className="w-full md:w-1/2">
                <Label htmlFor="imageUpload" className="block text-gray-300 text-lg font-medium mb-2">
                  تحميل من ملف:
                </Label>
                <div className="file-input-custom">
                  <input type="file" id="imageUpload" accept="image/*" onChange={handleImageUpload} ref={imageUploadRef} disabled={isLoading} />
                  <label htmlFor="imageUpload">
                    <Upload className="h-5 w-5" /> اختر ملف
                  </label>
                </div>
              </div>
              <div className="w-full md:w-1/2">
                <Label className="block text-gray-300 text-lg font-medium mb-2">
                  التقاط من الكاميرا:
                </Label>
                <div className="flex flex-wrap gap-2 mt-0">
                  {!cameraStream ? (
                    <Button onClick={handleStartCamera} id="startCameraBtn" className="control-btn control-btn-indigo" variant="default" size="default" disabled={isLoading}>
                      <Video className="mr-2 h-5 w-5" /> تشغيل الكاميرا
                    </Button>
                  ) : (
                    <>
                      <Button onClick={switchCamera} id="switchCameraBtn" className="control-btn control-btn-orange" variant="default" size="default" disabled={isLoading}>
                        <RefreshCw className="mr-2 h-5 w-5" /> تبديل
                      </Button>
                      <Button onClick={captureImageFromCamera} id="captureImageBtn" className="control-btn control-btn-teal" variant="default" size="default" disabled={isLoading}>
                        <CameraIcon className="mr-2 h-5 w-5" /> التقاط
                      </Button>
                      <Button onClick={stopCameraInternal} id="stopCameraBtn" className="control-btn control-btn-gray" variant="secondary" size="default" disabled={isLoading}>
                        <VideoOff className="mr-2 h-5 w-5" /> إيقاف
                      </Button>
                    </>
                  )}
                </div>
                {cameraStream && (
                  <div id="videoContainer" className="video-container-active mt-4">
                    <video id="cameraFeed" ref={cameraFeedRef} autoPlay playsInline className="w-full h-auto aspect-video bg-black"></video>
                    <canvas id="cameraCanvas" ref={cameraCanvasRef} style={{ display: 'none' }}></canvas>
                  </div>
                )}
              </div>
            </div>
            {imagePreview && (
              <div id="imagePreview" className="image-preview-container mt-6 h-48">
                <Image src={imagePreview} alt="معاينة الصورة" width={180} height={180} className="max-h-full max-w-full object-contain rounded-lg" data-ai-hint="medical image"/>
              </div>
            )}
          </div>

          <Button
            id="sendMessageBtn"
            onClick={() => handleSendMessage()}
            disabled={isLoading}
            className="w-full control-btn control-btn-blue py-3 md:py-4 rounded-xl text-xl md:text-2xl"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-3 h-6 w-6 animate-spin" />
                <span>جاري المعالجة...</span>
              </>
            ) : (
              <>
                <Send className="mr-2 h-5 w-5" />
                <span id="buttonText">إرسال الرسالة</span>
              </>
            )}
          </Button>

          <div id="messageBox" ref={messageBoxRef} className="message-box-global hidden mt-6">
            <p id="messageTextRef" ref={messageTextRef} className="font-medium text-lg"></p>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}

