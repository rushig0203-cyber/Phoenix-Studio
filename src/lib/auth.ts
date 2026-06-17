import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db) as any,
  session: {
    strategy: "jwt",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Missing email or password");
        }

        const user = await db.user.findUnique({
          where: { email: credentials.email },
        });

        // If no user exists, create a default admin or user for sandbox mode
        if (!user) {
          // If we want a seamless first-time startup, we can auto-register a default creator
          // this is very helpful for sandbox environment runs.
          const hashedPassword = await bcrypt.hash(credentials.password, 10);
          
          // Determine if first user is admin
          const userCount = await db.user.count();
          const role = userCount === 0 ? "ADMIN" : "USER";

          const newUser = await db.user.create({
            data: {
              email: credentials.email,
              password: hashedPassword,
              name: credentials.email.split("@")[0],
              role: role,
              remainingMins: 120.0,
            },
          });

          return {
            id: newUser.id,
            name: newUser.name,
            email: newUser.email,
            role: newUser.role,
          };
        }

        if (!user.password) {
          throw new Error("Credentials login not configured for this account");
        }

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) {
          throw new Error("Invalid password");
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET || "auraclip-nextauth-super-secret-key-12345",
};
