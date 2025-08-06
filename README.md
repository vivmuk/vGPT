# vGPT - Advanced AI Chat Application

[![React Native](https://img.shields.io/badge/React%20Native-0.74.5-blue.svg)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-Latest-black.svg)](https://expo.dev/)
[![Venice AI](https://img.shields.io/badge/Venice%20AI-Integrated-orange.svg)](https://venice.ai/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3.3-blue.svg)](https://www.typescriptlang.org/)

A beautiful, feature-rich mobile chat application built with React Native and Expo, powered by Venice AI's advanced language models. Features a stunning UI, comprehensive model selection, and advanced AI configuration options.

![vGPT Screenshot](https://via.placeholder.com/800x400/FF6B47/FFFFFF?text=vGPT+Chat+Interface)

## ✨ Features

### 🤖 AI-Powered Chat
- **Multiple AI Models**: Access to Venice AI's complete model lineup including:
  - Venice Small (Qwen 3.4B) - Fast and efficient
  - Venice Medium (Mistral 3.1 24B) - Balanced performance
  - Venice Large (Qwen 3 235B) - Maximum capability
  - Venice Reasoning (Qwen 2.5 QwQ 32B) - Advanced reasoning
  - DeepSeek R1 671B - State-of-the-art reasoning
  - Specialized models for coding, vision, and more

### 🎨 Beautiful UI Design
- **Modern Interface**: Clean, professional design with subtle animations
- **Enhanced Typography**: Carefully crafted font hierarchy and spacing
- **Smooth Animations**: Delightful user interactions and transitions
- **Responsive Layout**: Optimized for various screen sizes

### ⚙️ Advanced Configuration
- **Model Selection**: Easy switching between AI models with detailed information
- **Temperature Control**: Fine-tune creativity and randomness (0.0 - 2.0)
- **Nucleus Sampling (Top P)**: Control response diversity (0.0 - 1.0)
- **Min P Filtering**: Set minimum probability thresholds
- **Token Limits**: Configurable response length (1 - 4096 tokens)
- **Web Search**: Enable AI to search the web for current information
- **Repetition Penalty**: Reduce repetitive responses

### 🌐 Web Search Integration
- **Smart Web Search**: AI can search the web when needed
- **Auto Mode**: Let the AI decide when to search
- **Manual Control**: Force web search on or off
- **Current Information**: Get up-to-date information and facts

### 📱 User Experience
- **Intuitive Navigation**: Easy access to all features
- **Visual Feedback**: Clear loading states and animations
- **Setting Explanations**: Helpful tooltips for all configuration options
- **Model Information**: Detailed specs including context length, capabilities, and pricing

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn
- Expo CLI
- React Native development environment

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/vivmuk/vGPT.git
   cd vGPT
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Install Expo CLI** (if not already installed)
   ```bash
   npm install -g expo-cli
   # or
   npm install -g @expo/cli
   ```

4. **Set up Convex backend**
   ```bash
   npx convex dev
   ```

5. **Start the development server**
   ```bash
   npm start
   # or
   expo start
   ```

6. **Run on device/simulator**
   - For iOS: Press `i` or scan QR code with Camera app
   - For Android: Press `a` or scan QR code with Expo Go app

## 🔧 Configuration

### Environment Setup
The app uses Convex for backend services. Make sure to:
1. Set up your Convex project at [convex.dev](https://convex.dev)
2. Configure your Venice AI API key in the Convex functions
3. Deploy your Convex functions

### Venice AI Integration
The app integrates with Venice AI's chat completions API. Features include:
- Real-time streaming responses
- Multiple model support
- Advanced parameter configuration
- Web search capabilities

## 📱 App Structure

```
vGPT/
├── app/                    # App screens and navigation
│   ├── index.tsx          # Main chat interface
│   ├── settings.tsx       # Settings and configuration
│   └── _layout.tsx        # App layout and navigation
├── convex/                # Backend functions
│   ├── venice.ts          # Venice AI integration
│   ├── settings.ts        # Settings management
│   └── schema.ts          # Database schema
├── assets/                # Images and fonts
└── package.json           # Dependencies and scripts
```

## 🎯 Key Features Explained

### Model Selection
- **Quick Switching**: Change models directly from the chat screen
- **Detailed Information**: View model capabilities, context limits, and pricing
- **Smart Recommendations**: See which models are best for different tasks

### Advanced Settings
- **Temperature**: Controls randomness (lower = more focused, higher = more creative)
- **Top P**: Nucleus sampling for response diversity
- **Min P**: Filters out unlikely tokens for better quality
- **Repetition Penalty**: Reduces repetitive text generation

### Web Search
- **Automatic**: AI decides when to search based on the query
- **Manual Control**: Force web search on/off for specific needs
- **Current Data**: Get real-time information and recent developments

## 🛠️ Built With

- **[React Native](https://reactnative.dev/)** - Mobile app framework
- **[Expo](https://expo.dev/)** - Development platform and tools
- **[TypeScript](https://www.typescriptlang.org/)** - Type-safe JavaScript
- **[Convex](https://convex.dev/)** - Backend-as-a-Service
- **[Venice AI](https://venice.ai/)** - Advanced AI models
- **[React Navigation](https://reactnavigation.org/)** - Navigation library
- **[Expo Vector Icons](https://docs.expo.dev/guides/icons/)** - Icon library

## 📖 API Documentation

### Venice AI Models

| Model | Context | Pricing (per 1M tokens) | Best For |
|-------|---------|-------------------------|----------|
| Venice Small | 32K | $0.15 in / $0.60 out | Quick responses |
| Venice Medium | 131K | $0.50 in / $2.00 out | Balanced tasks |
| Venice Large | 131K | $1.50 in / $6.00 out | Complex reasoning |
| Venice Reasoning | 32K | $0.50 in / $2.00 out | Logic problems |
| DeepSeek R1 | 131K | $3.50 in / $14.00 out | Advanced reasoning |

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Venice AI](https://venice.ai/) for providing powerful AI models
- [Convex](https://convex.dev/) for the excellent backend platform
- [Expo](https://expo.dev/) for the amazing development experience
- The React Native community for continuous innovation

## 📞 Support

If you have any questions or need help, please:
- Open an issue on GitHub
- Check the [documentation](https://github.com/vivmuk/vGPT/wiki)
- Contact the maintainer

---

**Made with ❤️ and powered by Venice AI**